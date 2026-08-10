import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSystemActor } from '@/lib/system-actor';
import { writeAuditLog } from '@/services/auditService';
import { applyPaymentConfirmationEffects } from '@/services/paymentConfirmationEffects';
import { scopedLogger } from '@/lib/logger';

/**
 * paypalConfirmation — le SEUL module qui fait bouger une ligne `payments` du
 * rail PAYPAL.
 *
 * Trois chemins l'appellent : la route de retour navigateur, le webhook PayPal
 * et le cron de réconciliation. Concentrer l'écriture ici garantit une seule
 * définition de l'idempotence, du contrôle de montant et des effets de bord.
 *
 * IDEMPOTENCE — deux gardes superposées :
 *   1. les statuts terminaux sortent avant tout UPDATE ;
 *   2. l'UPDATE est conditionné par `.eq('status', 'PROCESSING')` et on lit le
 *      nombre de lignes renvoyées. Zéro ligne = un autre chemin a gagné la
 *      course → on sort sans effet de bord. C'est ce qui garantit qu'un reçu
 *      n'est jamais émis deux fois pour le même paiement.
 *
 * MONTANT — le montant crédité est toujours `payments.amount_usd_minor`, calculé
 * à l'initiation depuis la transaction. Le montant renvoyé par PayPal ne sert
 * qu'à contrôler : devise ≠ USD ou écart > 1 cent → REJECTED + audit WARNING.
 * On ne convertit jamais une devise sur un paiement fiscal.
 *
 * Le client Supabase est fourni par l'appelant : client tenant pour la route de
 * retour (juridiction connue via requireOwner), client plateforme pour le
 * webhook et le cron (aucun contexte tenant, lookup par identifiant PayPal).
 */

const log = scopedLogger('paypal-confirmation');

/** Tolérance de comparaison de montant, en USD. */
const AMOUNT_TOLERANCE_USD = 0.01;

const TERMINAL_STATUSES = new Set(['CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED']);

export type PaypalConfirmOutcome =
    | 'CONFIRMED'
    | 'IDEMPOTENT_SKIP'
    | 'NOT_FOUND'
    | 'REJECTED_AMOUNT_MISMATCH'
    | 'ERROR';

export interface PaypalConfirmInput {
    /** Identifiant d'ordre PayPal = payments.external_reference. */
    orderId: string;
    captureId: string | null;
    /** Montant capturé en unités majeures, tel que renvoyé par PayPal. */
    paidAmount: string | null;
    paidCurrency: string | null;
    payerEmail?: string | null;
}

interface PaypalPaymentRow {
    id: string;
    status: string;
    transaction_id: string | null;
    shipowner_id: string;
    amount_usd_minor: number;
    currency: string;
    jurisdiction_id: string | null;
    rail_details: Record<string, unknown> | null;
}

async function findPaypalPayment(
    admin: SupabaseClient,
    orderId: string,
): Promise<PaypalPaymentRow | null> {
    const { data } = await admin
        .from('payments')
        .select(
            'id, status, transaction_id, shipowner_id, amount_usd_minor, currency, jurisdiction_id, rail_details',
        )
        .eq('external_reference', orderId)
        .eq('rail', 'PAYPAL')
        .maybeSingle();
    return (data as PaypalPaymentRow | null) ?? null;
}

/**
 * Marque un paiement PayPal comme confirmé.
 *
 * @returns `CONFIRMED` si cet appel a effectivement opéré la transition (et donc
 * déclenché reçu + e-mail + notification), `IDEMPOTENT_SKIP` si un autre chemin
 * l'avait déjà fait, `NOT_FOUND` si l'ordre est inconnu,
 * `REJECTED_AMOUNT_MISMATCH` si le contrôle de montant a échoué (la ligne passe
 * alors en REJECTED), `ERROR` sinon. Ne throw pas.
 */
export async function confirmPaypalPayment(
    admin: SupabaseClient,
    input: PaypalConfirmInput,
): Promise<{ outcome: PaypalConfirmOutcome; paymentId?: string }> {
    try {
        const payment = await findPaypalPayment(admin, input.orderId);
        if (!payment) {
            log.warn('paypal_payment_not_found', { orderId: input.orderId });
            return { outcome: 'NOT_FOUND' };
        }
        if (TERMINAL_STATUSES.has(payment.status)) {
            log.info('paypal_idempotent_skip', {
                orderId: input.orderId,
                paymentId: payment.id,
                currentStatus: payment.status,
            });
            return { outcome: 'IDEMPOTENT_SKIP', paymentId: payment.id };
        }

        // ── Contrôle du montant ──────────────────────────────────────────────
        const expectedUsd = payment.amount_usd_minor / 100;
        const mismatch = amountMismatch(input, expectedUsd);
        if (mismatch) {
            await admin
                .from('payments')
                .update({
                    status: 'REJECTED',
                    rejected_reason: `PayPal: ${mismatch.reason}`,
                    rail_details: mergeRailDetails(payment, input),
                })
                .eq('id', payment.id)
                .eq('status', payment.status)
                .select('id');

            log.error('payment_amount_mismatch', {
                orderId: input.orderId,
                paymentId: payment.id,
                ...mismatch.logFields,
            });

            const systemActorId = await resolveSystemActor(admin);
            if (systemActorId) {
                await writeAuditLog(admin, {
                    user_id: systemActorId,
                    user_full_name: 'PayPal Webhook',
                    action: 'TRANSACTION_UPDATED',
                    severity: 'WARNING',
                    entity_type: 'Transaction',
                    entity_id: payment.transaction_id ?? payment.id,
                    jurisdiction_id: payment.jurisdiction_id,
                    details_json: {
                        event: 'PAYMENT_AMOUNT_MISMATCH',
                        provider: 'paypal',
                        provider_ref: input.captureId ?? input.orderId,
                        ...mismatch.auditFields,
                    },
                });
            }
            return { outcome: 'REJECTED_AMOUNT_MISMATCH', paymentId: payment.id };
        }

        // ── Acteur système (payments_confirmed_audit exige confirmed_by) ─────
        const systemActorId = await resolveSystemActor(admin);
        if (!systemActorId) {
            log.error('paypal_no_system_actor', {
                orderId: input.orderId,
                paymentId: payment.id,
            });
            return { outcome: 'ERROR', paymentId: payment.id };
        }

        // ── Transition gardée ────────────────────────────────────────────────
        const confirmedAt = new Date().toISOString();
        const { data: updated, error: updErr } = await admin
            .from('payments')
            .update({
                status: 'CONFIRMED',
                confirmed_at: confirmedAt,
                confirmed_by: systemActorId,
                rail_details: mergeRailDetails(payment, input),
            })
            .eq('id', payment.id)
            .eq('status', 'PROCESSING')
            .select('id');

        if (updErr) {
            log.error('paypal_confirm_update_failed', {
                orderId: input.orderId,
                paymentId: payment.id,
                error: updErr.message,
            });
            return { outcome: 'ERROR', paymentId: payment.id };
        }
        if (!updated || updated.length === 0) {
            // Course perdue entre la lecture et l'UPDATE. Aucun effet de bord :
            // le gagnant les a déjà déclenchés.
            log.info('paypal_confirm_race_idempotent', {
                orderId: input.orderId,
                paymentId: payment.id,
            });
            return { outcome: 'IDEMPOTENT_SKIP', paymentId: payment.id };
        }

        // ── Recalcul du statut de transaction ────────────────────────────────
        if (payment.transaction_id) {
            const { error: rpcErr } = await admin.rpc('recompute_transaction_status', {
                p_txn_id: payment.transaction_id,
            });
            if (rpcErr) {
                // Le trigger sur payments recalcule aussi — loguer sans échouer.
                log.error('recompute_transaction_status_failed', {
                    paymentId: payment.id,
                    transactionId: payment.transaction_id,
                    error: rpcErr.message,
                });
            }
        }

        log.info('paypal_payment_confirmed', {
            orderId: input.orderId,
            paymentId: payment.id,
            transactionId: payment.transaction_id,
            amountUsdMinor: payment.amount_usd_minor,
        });

        // Effets fail-soft — on a gagné la course, donc exactement une fois.
        await applyPaymentConfirmationEffects(
            admin,
            {
                id: payment.id,
                shipowner_id: payment.shipowner_id,
                transaction_id: payment.transaction_id,
                amount_usd_minor: payment.amount_usd_minor,
            },
            confirmedAt,
        );

        return { outcome: 'CONFIRMED', paymentId: payment.id };
    } catch (e) {
        log.error('paypal_confirm_unhandled_error', {
            orderId: input.orderId,
            error: e instanceof Error ? e.message : String(e),
        });
        return { outcome: 'ERROR' };
    }
}

function mergeRailDetails(
    payment: PaypalPaymentRow,
    input: PaypalConfirmInput,
): Record<string, unknown> {
    return {
        ...(payment.rail_details ?? {}),
        paypal_order_id: input.orderId,
        paypal_capture_id: input.captureId,
        payer_email: input.payerEmail ?? null,
    };
}

interface Mismatch {
    reason: string;
    logFields: Record<string, unknown>;
    auditFields: Record<string, unknown>;
}

/**
 * Contrôle devise + montant. `null` = pas d'écart (y compris quand PayPal ne
 * renvoie aucun montant : la capture est alors connue par un autre chemin et
 * `amount_usd_minor` reste la vérité).
 */
function amountMismatch(input: PaypalConfirmInput, expectedUsd: number): Mismatch | null {
    if (input.paidCurrency && input.paidCurrency !== 'USD') {
        return {
            reason: 'non_usd_currency',
            logFields: { reason: 'non_usd_currency', paidCurrency: input.paidCurrency },
            auditFields: {
                reason: 'non_usd_currency',
                paid_currency: input.paidCurrency,
                expected_currency: 'USD',
            },
        };
    }
    if (input.paidAmount == null) return null;

    const paid = parseFloat(input.paidAmount);
    if (Number.isNaN(paid)) {
        return {
            reason: 'unparseable_amount',
            logFields: { reason: 'unparseable_amount', paidAmount: input.paidAmount },
            auditFields: { reason: 'unparseable_amount', paid_amount: input.paidAmount },
        };
    }

    const diff = Math.abs(paid - expectedUsd);
    if (diff > AMOUNT_TOLERANCE_USD) {
        return {
            reason: `amount_mismatch expected=${expectedUsd} received=${paid}`,
            logFields: { expectedUsd, receivedUsd: paid, diffUsd: diff },
            auditFields: { expected_usd: expectedUsd, received_usd: paid, diff_usd: diff },
        };
    }
    return null;
}

/** Transition gardée partagée par reject / cancel. */
async function terminalTransition(
    admin: SupabaseClient,
    orderId: string,
    patch: Record<string, unknown>,
    logEvent: string,
): Promise<{ ok: boolean; skipped: boolean; notFound: boolean }> {
    const payment = await findPaypalPayment(admin, orderId);
    if (!payment) {
        log.warn('paypal_payment_not_found', { orderId });
        return { ok: false, skipped: false, notFound: true };
    }
    if (TERMINAL_STATUSES.has(payment.status)) {
        log.info('paypal_idempotent_skip', {
            orderId,
            paymentId: payment.id,
            currentStatus: payment.status,
        });
        return { ok: false, skipped: true, notFound: false };
    }

    const { data: updated, error } = await admin
        .from('payments')
        .update(patch)
        .eq('id', payment.id)
        .eq('status', 'PROCESSING')
        .select('id');

    if (error) {
        log.error(`${logEvent}_failed`, { orderId, paymentId: payment.id, error: error.message });
        return { ok: false, skipped: false, notFound: false };
    }
    if (!updated || updated.length === 0) {
        return { ok: false, skipped: true, notFound: false };
    }
    log.info(logEvent, { orderId, paymentId: payment.id });
    return { ok: true, skipped: false, notFound: false };
}

/**
 * Passe un paiement PayPal en REJECTED (capture refusée par PayPal).
 * La raison est préfixée `PayPal:` — même convention que le webhook Stripe.
 */
export async function rejectPaypalPayment(
    admin: SupabaseClient,
    orderId: string,
    reason: string,
): Promise<{ outcome: 'REJECTED' | 'IDEMPOTENT_SKIP' | 'NOT_FOUND' | 'ERROR' }> {
    try {
        const r = await terminalTransition(
            admin,
            orderId,
            { status: 'REJECTED', rejected_reason: `PayPal: ${reason}` },
            'paypal_payment_rejected',
        );
        if (r.notFound) return { outcome: 'NOT_FOUND' };
        if (r.skipped) return { outcome: 'IDEMPOTENT_SKIP' };
        return { outcome: r.ok ? 'REJECTED' : 'ERROR' };
    } catch (e) {
        log.error('paypal_reject_unhandled_error', {
            orderId,
            error: e instanceof Error ? e.message : String(e),
        });
        return { outcome: 'ERROR' };
    }
}

/** Passe un paiement PayPal en CANCELLED (ordre annulé ou expiré). */
export async function cancelPaypalPayment(
    admin: SupabaseClient,
    orderId: string,
    reason?: string,
): Promise<{ outcome: 'CANCELLED' | 'IDEMPOTENT_SKIP' | 'NOT_FOUND' | 'ERROR' }> {
    try {
        const r = await terminalTransition(
            admin,
            orderId,
            {
                status: 'CANCELLED',
                ...(reason ? { rejected_reason: `PayPal: ${reason}` } : {}),
            },
            'paypal_payment_cancelled',
        );
        if (r.notFound) return { outcome: 'NOT_FOUND' };
        if (r.skipped) return { outcome: 'IDEMPOTENT_SKIP' };
        return { outcome: r.ok ? 'CANCELLED' : 'ERROR' };
    } catch (e) {
        log.error('paypal_cancel_unhandled_error', {
            orderId,
            error: e instanceof Error ? e.message : String(e),
        });
        return { outcome: 'ERROR' };
    }
}
