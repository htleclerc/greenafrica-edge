'use server';

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lockRate } from '@/services/fxRateService';
import { createCheckoutSession } from '@/services/stripeService';
import { createOrder as createPaypalOrder, paypalConfigured } from '@/services/paypalService';
import { requireOwner } from '@/lib/auth/requireOwner';
import { applyWalletCredit } from '@/services/walletApplyService';
import { createTenantClient } from '@/lib/supabase/tenant';

const OWNER_RAILS = ['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET', 'STRIPE', 'PAYPAL'] as const;
const ALL_RAILS = [
    'STRIPE', 'PAYPAL', 'WIRE_TRANSFER', 'CASH', 'CHEQUE', 'LETTER_OF_CREDIT',
    'NETTING', 'THIRD_PARTY', 'MOBILE_MONEY', 'BANK_GUARANTEE', 'WALLET',
] as const;

const schema = z.object({
    transactionId: z.string().uuid().nullable(),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Decimal with up to 2 fraction digits'),
    currency: z.string().length(3),
    rail: z.enum(ALL_RAILS),
    railDetails: z.record(z.string(), z.unknown()),
    /**
     * Part reglee depuis le portefeuille, en cents USD. `amount` ne porte
     * alors QUE le reste a payer sur le rail — les deux montants sont
     * disjoints, jamais le total.
     */
    walletApplyUsdMinor: z.number().int().positive().optional(),
});

interface InitiatePaymentInput {
    transactionId: string | null;
    amount: string;
    currency: string;
    rail: typeof ALL_RAILS[number];
    railDetails: Record<string, unknown>;
    /** Part reglee depuis le portefeuille (cents USD), hors `amount`. */
    walletApplyUsdMinor?: number;
}

const SELECTED_COLUMNS = 'id, status, transaction_id, amount_usd_minor';

/**
 * Ligne `payments` créée, plus l'URL de checkout quand le rail en a une.
 *
 * `checkoutUrl` n'est présent que pour les rails à checkout externe (STRIPE,
 * PAYPAL) : l'appelant doit y rediriger le navigateur. Les rails manuels
 * renvoient la ligne seule.
 */
export interface InitiatePaymentResult {
    id: string;
    status: string;
    transaction_id: string | null;
    amount_usd_minor: number;
    checkoutUrl?: string;
}

function appBaseUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300';
}

/**
 * Page sur laquelle retombe l'armateur au retour d'un checkout externe.
 * Une recharge de portefeuille n'a pas de facture en face : la renvoyer sur
 * la liste des factures donnait l'impression que le top-up s'etait perdu.
 */
function landingPath(transactionId: string | null): string {
    return transactionId ? '/dashboard/invoices' : '/dashboard/wallet';
}

/** Champs communs à toutes les lignes `payments` créées par l'armateur. */
interface RowCommon {
    transaction_id: string | null;
    shipowner_id: string;
    declared_by: string;
    amount_minor: number;
    currency: string;
    amount_usd_minor: number;
    fx_rate: number | null;
    fx_rate_source: string | null;
    fx_rate_locked_at: string | null;
    rail_details: Record<string, unknown>;
}

async function insertPaymentRow(
    admin: SupabaseClient,
    row: Record<string, unknown>,
): Promise<InitiatePaymentResult> {
    const { data, error } = await admin
        .from('payments').insert(row).select(SELECTED_COLUMNS).single();
    if (error) throw error;
    return data as InitiatePaymentResult;
}

/**
 * Rail STRIPE : crée une Checkout Session, puis la ligne `payments` en
 * PROCESSING. Le webhook la passe à CONFIRMED.
 */
async function initiateStripe(
    admin: SupabaseClient,
    rowCommon: RowCommon,
    shipownerId: string,
    railDetails: Record<string, unknown>,
    beforeInsert: () => Promise<void>,
) {
    const baseUrl = appBaseUrl();
    const landing = landingPath(rowCommon.transaction_id);
    const session = await createCheckoutSession({
        // Option A: payment row id is not yet known. The webhook looks up by
        // external_reference = stripe_payment_intent_id, not by metadata.payment_id.
        paymentId: '',
        invoiceId: rowCommon.transaction_id ?? '',
        shipownerId,
        amountUsdMinor: rowCommon.amount_usd_minor,
        successUrl: `${baseUrl}${landing}?stripe=success`,
        cancelUrl: `${baseUrl}${landing}?stripe=cancel`,
    });

    // Le portefeuille se débite APRÈS l'appel sortant : si Stripe refuse la
    // session, rien n'a bougé côté solde.
    await beforeInsert();

    // Le PaymentIntent n'existe pas encore à l'ouverture de la session (API
    // 2026-04-22) : on indexe la ligne sur l'id de session, et le webhook
    // `checkout.session.completed` réécrit `external_reference` avec le
    // PaymentIntent dès qu'il est connu.
    const data = await insertPaymentRow(admin, {
        ...rowCommon,
        rail: 'STRIPE',
        status: 'PROCESSING',
        external_reference: session.stripePaymentIntentId ?? session.stripeSessionId,
        rail_details: {
            ...railDetails,
            stripe_session_id: session.stripeSessionId,
            stripe_payment_intent_id: session.stripePaymentIntentId,
        },
    });
    return { ...data, checkoutUrl: session.checkoutUrl };
}

/**
 * Rail PAYPAL : crée un ordre Orders v2 (intent CAPTURE), puis la ligne
 * `payments` en PROCESSING. La capture a lieu au retour navigateur
 * (/api/payments/paypal/return), avec webhook et cron en filet.
 */
async function initiatePaypal(
    admin: SupabaseClient,
    rowCommon: RowCommon,
    railDetails: Record<string, unknown>,
    beforeInsert: () => Promise<void>,
) {
    // Fail-fast avant tout INSERT : mieux vaut une erreur visible dans le
    // dialogue qu'une ligne payments orpheline sans ordre PayPal en face.
    if (!paypalConfigured()) {
        throw new Error('PayPal is not configured on this environment');
    }

    const baseUrl = appBaseUrl();

    // La référence de facture voyage jusqu'à PayPal (referenceId + description)
    // pour que l'armateur la retrouve sur son relevé PayPal. Best-effort : un
    // top-up n'a pas de facture.
    let invoiceRef = rowCommon.transaction_id ?? 'TOPUP';
    if (rowCommon.transaction_id) {
        const { data: tx } = await admin
            .from('transactions')
            .select('invoice_ref')
            .eq('id', rowCommon.transaction_id)
            .maybeSingle();
        const ref = (tx as { invoice_ref?: string | null } | null)?.invoice_ref;
        if (ref) invoiceRef = ref;
    }

    // L'ordre est créé AVANT l'INSERT : si PayPal refuse, on throw sans avoir
    // rien écrit. L'inverse laisserait des lignes PROCESSING sans ordre en
    // face, que le cron devrait annuler.
    const order = await createPaypalOrder({
        amountUsdMinor: rowCommon.amount_usd_minor,
        transactionId: rowCommon.transaction_id,
        invoiceRef,
        returnUrl: `${baseUrl}/api/payments/paypal/return`,
        cancelUrl: `${baseUrl}${landingPath(rowCommon.transaction_id)}?paypal=cancel`,
    });

    // Même ordre que STRIPE : l'ordre PayPal existe, on peut débiter.
    await beforeInsert();

    const data = await insertPaymentRow(admin, {
        ...rowCommon,
        rail: 'PAYPAL',
        // PROCESSING, comme STRIPE : l'ordre existe côté PayPal mais rien n'est
        // encaissé avant la capture.
        status: 'PROCESSING',
        external_reference: order.orderId,
        rail_details: { ...railDetails, paypal_order_id: order.orderId },
    });
    return { ...data, checkoutUrl: order.approveUrl };
}

export async function initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const parsed = schema.parse(input);

    const ctx = await requireOwner();
    if (!OWNER_RAILS.includes(parsed.rail as typeof OWNER_RAILS[number])) {
        throw new Error(`owner cannot initiate rail=${parsed.rail}`);
    }

    // Owner-initiated payment → scope to the operator's home jurisdiction so the
    // payments INSERT below is auto-stamped jurisdiction_id (matches ctx.shipowner).
    // fx_rates is global and passes through unchanged.
    const admin = createTenantClient(ctx.jurisdictionId);

    const fx = await lockRate(admin, parsed.currency);

    const amountMinor = Math.round(parseFloat(parsed.amount) * 100);
    const isUsd = parsed.currency === 'USD';
    const amountUsdMinor = isUsd ? amountMinor : Math.round(amountMinor / fx.rate);

    const rowCommon: RowCommon = {
        transaction_id: parsed.transactionId,
        shipowner_id: ctx.shipowner.id,
        declared_by: ctx.userId,
        amount_minor: amountMinor,
        currency: parsed.currency,
        amount_usd_minor: amountUsdMinor,
        fx_rate: isUsd ? null : fx.rate,
        fx_rate_source: isUsd ? null : fx.source,
        fx_rate_locked_at: isUsd ? null : fx.lockedAt,
        rail_details: parsed.railDetails,
    };

    // ── Part portefeuille d'un paiement mixte ────────────────────────────
    //
    // Le portefeuille couvre une partie de la facture, le rail choisi couvre
    // le reste. Le débit est joué APRÈS l'appel au prestataire et AVANT
    // l'INSERT de la ligne du rail : un refus de Stripe ou PayPal laisse alors
    // le solde intact, et l'armateur peut recommencer.
    //
    // Le sens inverse — débiter d'abord — laisserait le crédit consommé face à
    // un checkout qui n'a jamais existé.
    const walletApplyMinor = parsed.walletApplyUsdMinor ?? 0;
    if (walletApplyMinor > 0) {
        if (!parsed.transactionId) {
            // Une recharge n'a pas de facture à créditer : le portefeuille ne
            // peut pas s'alimenter lui-même.
            throw new Error('Wallet credit cannot fund a top-up');
        }
        if (parsed.rail === 'WALLET') {
            throw new Error('Use the WALLET rail alone to pay from the wallet');
        }
        // La facture doit être celle de l'armateur : `applyWalletCredit` ne
        // revérifie que le portefeuille, pas la propriété de la transaction.
        const { data: tx, error: txErr } = await admin
            .from('transactions')
            .select('id, shipowner_id')
            .eq('id', parsed.transactionId)
            .single();
        if (txErr) throw txErr;
        if (tx.shipowner_id !== ctx.shipowner.id) throw new Error('Not your transaction');
    }

    const applyWalletPart = async () => {
        if (walletApplyMinor <= 0) return;
        await applyWalletCredit(admin, {
            transactionId: parsed.transactionId as string,
            shipownerId: ctx.shipowner.id,
            actorUserId: ctx.userId,
            amountMinor: walletApplyMinor,
        });
    };

    // La ligne du rail garde la trace de la part portefeuille : sans elle, un
    // relevé montre deux paiements sans lien pour la même facture.
    const railDetails = walletApplyMinor > 0
        ? { ...parsed.railDetails, wallet_applied_usd_minor: walletApplyMinor }
        : parsed.railDetails;
    rowCommon.rail_details = railDetails;

    if (parsed.rail === 'STRIPE') {
        return initiateStripe(admin, rowCommon, ctx.shipowner.id, railDetails, applyWalletPart);
    }
    if (parsed.rail === 'PAYPAL') {
        return initiatePaypal(admin, rowCommon, railDetails, applyWalletPart);
    }

    // Rails manuels : la ligne naît INITIATED, un staff la confirme.
    await applyWalletPart();
    return insertPaymentRow(admin, {
        ...rowCommon,
        rail: parsed.rail,
        status: 'INITIATED',
    });
}
