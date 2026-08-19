import { NextRequest, NextResponse } from 'next/server';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { verifyWebhookSignature } from '@/services/stripeService';
import { resolveSystemActor } from '@/lib/system-actor';
import { applyPaymentConfirmationEffects } from '@/services/paymentConfirmationEffects';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('stripe-webhook');

/**
 * POST /api/webhooks/stripe
 *
 * Dedicated Stripe webhook handler. Verifies HMAC via stripeService.
 * Dispatches on event type; idempotent on terminal payment statuses.
 *
 * Handled events (v1):
 *   - payment_intent.succeeded      → UPDATE payments → CONFIRMED + capture
 *     stripe_charge_id, payment_method_type, fx_rate_source='STRIPE_SETTLE'
 *     into rail_details; puis délègue les effets (reçu PDF, e-mail,
 *     notification in-app) à `paymentConfirmationEffects`, partagé avec le
 *     rail PAYPAL.
 *   - payment_intent.payment_failed → UPDATE payments → REJECTED + reason.
 *   - checkout.session.expired      → UPDATE payments → CANCELLED.
 *   - charge.refunded               → idempotent safety net for Plan 7G
 *     `executeRefund`: reconciles refunds rows in APPROVED|REQUESTED state
 *     to EXECUTED if their `rail_details.stripe_refund_id` matches one of
 *     the refund objects in the event payload. Already-EXECUTED rows no-op.
 *
 * Status codes:
 *   - 400 on missing / invalid signature (Stripe retries briefly then stops)
 *   - 200 on success OR intentionally-skipped events (idempotent / unhandled)
 *   - 200 even on internal handler errors (logged) — avoids retry storms.
 *
 * System actor handling: Plan 7A mig 048 `payments_confirmed_audit`
 * CHECK constraint requires `confirmed_by NOT NULL` when status='CONFIRMED'.
 * Webhooks have no human actor, so we mirror Plan 7C-1 mig 059's stopgap:
 * pick the oldest active SUPERADMIN/FINANCE_ADMIN profile.
 * TECH_DEBT: same long-term fixes as mig 059 apply here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TERMINAL_STATUSES = new Set(['CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED']);

function serviceClient(): SupabaseClient {
    // Platform-level webhook (Stripe events keyed by external id; idempotent reconciler).
    return createPlatformClient();
}

interface PaymentRow {
    id: string;
    status: string;
    transaction_id: string | null;
    shipowner_id: string;
    amount_usd_minor: number;
    currency: string;
    rail_details: Record<string, unknown> | null;
}

async function findStripePayment(
    admin: SupabaseClient,
    paymentIntentId: string,
): Promise<PaymentRow | null> {
    const { data, error } = await admin
        .from('payments')
        .select('id, status, transaction_id, shipowner_id, amount_usd_minor, currency, rail_details')
        .eq('external_reference', paymentIntentId)
        .eq('rail', 'STRIPE')
        .maybeSingle();
    if (error) throw error;
    return data as PaymentRow | null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const sig = req.headers.get('stripe-signature');
    if (!sig) {
        return NextResponse.json({ error: 'missing signature' }, { status: 400 });
    }

    const rawBody = await req.text();
    let event: ReturnType<typeof verifyWebhookSignature>;
    try {
        event = verifyWebhookSignature(rawBody, sig);
    } catch (e) {
        log.warn('webhook_signature_invalid', {
            error: e instanceof Error ? e.message : 'invalid signature',
        });
        return NextResponse.json(
            { error: e instanceof Error ? e.message : 'invalid signature' },
            { status: 400 },
        );
    }

    log.info('webhook_event_received', { eventId: event.id, eventType: event.type });

    const admin = serviceClient();

    try {
        switch (event.type) {
            case 'payment_intent.succeeded': {
                await handlePaymentSucceeded(
                    admin,
                    event.data.object as unknown as Record<string, unknown>,
                );
                break;
            }
            case 'payment_intent.payment_failed': {
                await handlePaymentFailed(
                    admin,
                    event.data.object as unknown as Record<string, unknown>,
                );
                break;
            }
            case 'checkout.session.expired': {
                await handleCheckoutExpired(
                    admin,
                    event.data.object as unknown as Record<string, unknown>,
                );
                break;
            }
            case 'charge.refunded': {
                await handleChargeRefunded(
                    admin,
                    event.data.object as unknown as Record<string, unknown>,
                );
                break;
            }
            default:
                log.warn('webhook_unhandled_event', { eventId: event.id, eventType: event.type });
        }
        return NextResponse.json({ received: true });
    } catch (e) {
        log.error('webhook_handler_error', {
            eventId: event.id,
            eventType: event.type,
            error: e instanceof Error ? e.message : String(e),
        });
        // 200 to acknowledge — avoid retry storms on persistent bugs. Errors are logged.
        return NextResponse.json({ received: true, error: true });
    }
}

async function handlePaymentSucceeded(
    admin: SupabaseClient,
    pi: Record<string, unknown>,
): Promise<void> {
    const piId = pi.id as string;
    const payment = await findStripePayment(admin, piId);
    if (!payment) {
        log.warn('webhook_payment_not_found', { stripePiId: piId });
        return;
    }
    if (TERMINAL_STATUSES.has(payment.status)) {
        log.info('webhook_idempotent_skip', {
            stripePiId: piId,
            paymentId: payment.id,
            currentStatus: payment.status,
        });
        return;
    }

    const chargeId = (pi.latest_charge as string | null) ?? null;
    const paymentMethodTypes = pi.payment_method_types as string[] | undefined;
    const mergedRailDetails: Record<string, unknown> = {
        ...(payment.rail_details ?? {}),
        stripe_charge_id: chargeId,
        payment_method_type: paymentMethodTypes?.[0] ?? null,
        fx_rate_source: 'STRIPE_SETTLE',
    };

    const systemActorId = await resolveSystemActor(admin);
    if (!systemActorId) {
        throw new Error(
            'No active system actor (SUPERADMIN/FINANCE_ADMIN) found to satisfy payments_confirmed_audit',
        );
    }

    const confirmedAt = new Date().toISOString();
    const { error: updErr } = await admin
        .from('payments')
        .update({
            status: 'CONFIRMED',
            confirmed_at: confirmedAt,
            confirmed_by: systemActorId,
            rail_details: mergedRailDetails,
        })
        .eq('id', payment.id);
    if (updErr) throw updErr;

    if (payment.transaction_id) {
        const { error: rpcErr } = await admin.rpc('recompute_transaction_status', {
            p_txn_id: payment.transaction_id,
        });
        if (rpcErr) {
            // Payments trigger recomputes too — log, don't fail the webhook.
            log.error('recompute_transaction_status_failed', {
                paymentId: payment.id,
                transactionId: payment.transaction_id,
                error: rpcErr.message,
            });
        }
    }

    log.info('webhook_payment_succeeded', {
        stripePiId: piId,
        paymentId: payment.id,
        transactionId: payment.transaction_id,
        amountUsdMinor: payment.amount_usd_minor,
    });

    // Reçu PDF + e-mail + notification in-app. Fail-soft : le paiement reste
    // CONFIRMED même si un effet échoue. Partagé avec le rail PAYPAL.
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
}

async function handlePaymentFailed(
    admin: SupabaseClient,
    pi: Record<string, unknown>,
): Promise<void> {
    const piId = pi.id as string;
    const reason =
        (pi.last_payment_error as { message?: string } | undefined)?.message ?? 'unknown';

    const payment = await findStripePayment(admin, piId);
    if (!payment) return;
    if (TERMINAL_STATUSES.has(payment.status)) return;

    const { error } = await admin
        .from('payments')
        .update({
            status: 'REJECTED',
            rejected_reason: `Stripe: ${reason}`,
        })
        .eq('id', payment.id);
    if (error) throw error;

    // Match rejectPayment convention: log reason LENGTH, not the text. The
    // text is already persisted in payments.rejected_reason. Final-review fix.
    log.info('webhook_payment_failed', {
        stripePiId: piId,
        paymentId: payment.id,
        transactionId: payment.transaction_id,
        reasonLen: reason.length,
    });

    // Notify owner of the failed payment (fail-soft). Closes the UX gap
    // where admin-rejected payments produce a notification but Stripe-
    // failed payments did not.
    try {
        const { notifyOwner } = await import('@/services/notificationService');
        let invoiceRef: string | undefined;
        if (payment.transaction_id) {
            const { data: tx } = await admin
                .from('transactions')
                .select('invoice_ref')
                .eq('id', payment.transaction_id)
                .single();
            invoiceRef = (tx as { invoice_ref?: string } | null)?.invoice_ref;
        }
        await notifyOwner(admin, {
            shipownerId: payment.shipowner_id,
            kind: 'PAYMENT_REJECTED',
            params: {
                invoice_ref: invoiceRef ?? '—',
                reason: `Stripe: ${reason}`,
            },
            deepLink: invoiceRef
                ? `/owner/invoices?ref=${encodeURIComponent(invoiceRef)}`
                : '/owner/invoices',
        });
    } catch (notifyErr) {
        log.warn('notification_dispatch_failed', {
            paymentId: payment.id,
            stage: 'payment_failed',
            error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        });
    }
}

async function handleCheckoutExpired(
    admin: SupabaseClient,
    session: Record<string, unknown>,
): Promise<void> {
    const piId = session.payment_intent as string | null;
    if (!piId) return;

    const payment = await findStripePayment(admin, piId);
    if (!payment) return;
    if (TERMINAL_STATUSES.has(payment.status)) return;

    const { error } = await admin
        .from('payments')
        .update({ status: 'CANCELLED' })
        .eq('id', payment.id);
    if (error) throw error;

    log.info('webhook_checkout_expired', {
        stripePiId: piId,
        paymentId: payment.id,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 8: charge.refunded handler
//
// Idempotent safety net for executeRefund's synchronous Stripe refund path.
// The canonical path is the action (Task 6): it calls stripe.refunds.create,
// then UPDATEs the refunds row to EXECUTED. If the API call succeeded but the
// DB UPDATE failed (network blip, process killed, race), Stripe still fires
// charge.refunded — we reconcile here.
//
// Stripe semantics — partial refunds: a single charge can be refunded multiple
// times (each partial below the captured amount). Each refund emits its own
// `charge.refunded` event, but `charge.refunds.data[]` carries the FULL list
// of refunds for that charge at that point in time. We loop through them all,
// tolerate already-EXECUTED rows as no-op, and only transition APPROVED|
// REQUESTED rows.
// ─────────────────────────────────────────────────────────────────────────────

interface RefundReconcileRow {
    id: string;
    status: string;
    shipowner_id: string;
    transaction_id: string;
    amount_usd_minor: number;
    rail_details: Record<string, unknown> | null;
    refund_rail: string | null;
    jurisdiction_id: string | null;
}

async function handleChargeRefunded(
    admin: SupabaseClient,
    charge: Record<string, unknown>,
): Promise<void> {
    const chargeId = (charge.id as string | undefined) ?? '(unknown)';
    const paymentIntentId = charge.payment_intent as string | null;

    log.info('webhook_charge_refunded', { chargeId, paymentIntentId });

    // Defensive: Stripe always sets these but unknown shapes shouldn't crash.
    const refundsContainer = charge.refunds as { data?: unknown[] } | undefined;
    const refundObjects = (refundsContainer?.data ?? []) as Array<{ id?: string }>;
    if (!Array.isArray(refundObjects) || refundObjects.length === 0) {
        log.warn('charge_refunded_no_refund_objects', { chargeId });
        return;
    }

    // Resolve system actor once for the whole event (audit + executed_by).
    const systemActorId = await resolveSystemActor(admin);
    if (!systemActorId) {
        throw new Error(
            'No active system actor (SUPERADMIN/FINANCE_ADMIN) found to reconcile charge.refunded',
        );
    }

    for (const r of refundObjects) {
        const stripeRefundId = r?.id;
        if (!stripeRefundId) continue;

        // 1. Primary lookup: refunds row whose rail_details->>stripe_refund_id matches.
        const { data: primaryHit, error: primaryErr } = await admin
            .from('refunds')
            .select('id, status, shipowner_id, transaction_id, amount_usd_minor, rail_details, refund_rail, jurisdiction_id')
            .eq('rail_details->>stripe_refund_id', stripeRefundId)
            .limit(1)
            .maybeSingle();
        if (primaryErr) {
            log.error('refund_primary_lookup_failed', {
                chargeId,
                stripeRefundId,
                error: primaryErr.message,
            });
            continue;
        }

        let refundRow = primaryHit as RefundReconcileRow | null;

        // 2. Fallback lookup: action threw between Stripe API success and DB UPDATE.
        //    Find original payment by external_reference, then look up refunds
        //    for that transaction in rail=STRIPE + APPROVED|REQUESTED. Exactly
        //    one match = use it; multiple/none = log and skip.
        if (!refundRow && paymentIntentId) {
            const origPayment = await findStripePayment(admin, paymentIntentId);
            if (origPayment?.transaction_id) {
                const { data: fallbackList, error: fbErr } = await admin
                    .from('refunds')
                    .select('id, status, shipowner_id, transaction_id, amount_usd_minor, rail_details, refund_rail, jurisdiction_id')
                    .eq('transaction_id', origPayment.transaction_id)
                    .eq('refund_rail', 'STRIPE')
                    .in('status', ['APPROVED', 'REQUESTED'])
                    .limit(2);
                if (fbErr) {
                    log.error('refund_fallback_lookup_failed', {
                        chargeId,
                        stripeRefundId,
                        error: fbErr.message,
                    });
                    continue;
                }
                const arr = (fallbackList as RefundReconcileRow[] | null) ?? [];
                if (arr.length === 1) {
                    refundRow = arr[0];
                } else if (arr.length > 1) {
                    log.warn('refund_fallback_ambiguous', {
                        chargeId,
                        stripeRefundId,
                        transactionId: origPayment.transaction_id,
                        candidateCount: arr.length,
                    });
                    continue;
                }
            }
        }

        if (!refundRow) {
            log.warn('refund_no_match', {
                chargeId,
                stripeRefundId,
                paymentIntentId,
                note: 'possibly a Stripe-side manual refund not tracked locally',
            });
            continue;
        }

        // 3. Idempotent no-op for already-EXECUTED
        if (refundRow.status === 'EXECUTED') {
            log.info('refund_already_executed', { chargeId, refundId: refundRow.id });
            continue;
        }

        if (refundRow.status !== 'APPROVED' && refundRow.status !== 'REQUESTED') {
            log.warn('refund_unexpected_status', {
                chargeId,
                refundId: refundRow.id,
                status: refundRow.status,
            });
            continue;
        }

        // 4. Race-guarded UPDATE to EXECUTED
        const mergedRailDetails: Record<string, unknown> = {
            ...(refundRow.rail_details ?? {}),
            stripe_refund_id: stripeRefundId,
            webhook_reconciled: true,
        };
        const nowIso = new Date().toISOString();
        // mig 052's refunds_approved_audit CHECK requires approved_by NOT NULL
        // when status='EXECUTED'. If the refund was REQUESTED (no human approver
        // — e.g. the action threw between createRefund() success and the DB
        // UPDATE, leaving the trigger-inserted row at REQUESTED), set the
        // system actor as approved_by alongside the EXECUTED transition.
        const updatePayload: Record<string, unknown> = {
            status: 'EXECUTED',
            executed_by: systemActorId,
            executed_at: nowIso,
            rail_details: mergedRailDetails,
            updated_at: nowIso,
        };
        if (refundRow.status === 'REQUESTED') {
            updatePayload.approved_by = systemActorId;
            // CHECK refunds_rail_required_after_request also requires non-NULL
            // refund_rail once status leaves REQUESTED/REJECTED. If the row
            // hasn't picked a rail yet, set STRIPE (we know it's a Stripe
            // refund — that's how we got here).
            if (!refundRow.refund_rail) {
                updatePayload.refund_rail = 'STRIPE';
            }
        }
        const { data: updated, error: updErr } = await admin
            .from('refunds')
            .update(updatePayload)
            .eq('id', refundRow.id)
            .in('status', ['APPROVED', 'REQUESTED'])
            .select('id');
        if (updErr) {
            log.error('refund_update_failed', {
                chargeId,
                refundId: refundRow.id,
                error: updErr.message,
            });
            continue;
        }
        if (!updated || (updated as unknown[]).length === 0) {
            // Race: another path beat us. Treat as idempotent — log and move on.
            log.info('refund_reconcile_race_idempotent', {
                chargeId,
                refundId: refundRow.id,
            });
            continue;
        }

        log.info('refund_reconciled_by_webhook', {
            chargeId,
            refundId: refundRow.id,
            stripeRefundId,
            priorStatus: refundRow.status,
        });

        // 5. Fail-soft notification
        try {
            const { data: tx } = await admin
                .from('transactions')
                .select('invoice_ref')
                .eq('id', refundRow.transaction_id)
                .single();
            const invoiceRef = (tx as { invoice_ref?: string } | null)?.invoice_ref ?? null;

            const { notifyOwner } = await import('@/services/notificationService');
            await notifyOwner(admin, {
                shipownerId: refundRow.shipowner_id,
                kind: 'REFUND_ISSUED',
                params: {
                    invoice_ref: invoiceRef ?? '—',
                    amount_usd: refundRow.amount_usd_minor / 100,
                    refund_rail: 'STRIPE',
                    executed_at: nowIso,
                },
                deepLink: invoiceRef
                    ? `/owner/invoices?ref=${encodeURIComponent(invoiceRef)}`
                    : '/owner/invoices',
            });
        } catch (notifyErr) {
            log.warn('refund_notification_failed', {
                refundId: refundRow.id,
                error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
            });
        }

        // 6. Audit log (best-effort)
        try {
            await admin.from('audit_logs').insert({
                user_id: systemActorId,
                user_full_name: 'System (Stripe webhook)',
                action: 'TRANSACTION_UPDATED',
                severity: 'INFO',
                entity_type: 'Refund',
                entity_id: refundRow.id,
                jurisdiction_id: refundRow.jurisdiction_id,
                details_json: {
                    event: 'REFUND_RECONCILED_BY_WEBHOOK',
                    stripe_refund_id: stripeRefundId,
                    charge_id: chargeId,
                    payment_intent_id: paymentIntentId,
                },
            });
        } catch (auditErr) {
            log.warn('refund_audit_log_failed', {
                refundId: refundRow.id,
                error: auditErr instanceof Error ? auditErr.message : String(auditErr),
            });
        }
    }
}
