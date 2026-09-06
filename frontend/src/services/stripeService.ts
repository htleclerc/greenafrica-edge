import Stripe from 'stripe';

/**
 * stripeService — thin wrapper around the Stripe Node SDK.
 *
 * Isolates `import Stripe from 'stripe'` to this module so the rest of the
 * codebase imports from '@/services/stripeService'. This protects callers
 * from future SDK API churn and centralises configuration (api version,
 * secret key handling) in one place.
 *
 * Server-only — never import this module into client components.
 *
 * NOTE on api version: the Stripe v22.1.1 SDK type definitions only accept
 * the literal '2026-04-22.dahlia' (see node_modules/stripe/cjs/lib.d.ts —
 * `StripeConfig.apiVersion: LatestApiVersion = typeof ApiVersion`). The
 * earlier '2024-11-20.acacia' string referenced in plan drafts is rejected
 * by the v22 types, so we pin to the dahlia literal accepted by the SDK.
 */

const API_VERSION = '2026-04-22.dahlia' as const;

let cachedClient: Stripe | null = null;

/**
 * Test-only helper to clear the cached Stripe client between unit tests.
 * Production code MUST NOT call this — the client is intentionally cached
 * for the process lifetime. Exported solely so `stripeService.test.ts` can
 * exercise the "missing env var" branch after a successful prior call.
 */
export function __resetStripeClientForTests(): void {
    cachedClient = null;
}

/**
 * Returns a lazily-instantiated Stripe client. Throws if STRIPE_SECRET_KEY
 * is not configured. The client is cached for the lifetime of the process.
 */
function stripeClient(): Stripe {
    if (cachedClient) return cachedClient;
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
        throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    cachedClient = new Stripe(secret, { apiVersion: API_VERSION });
    return cachedClient;
}

export interface CreateCheckoutSessionInput {
    /** Amount to charge in USD minor units (cents). */
    amountUsdMinor: number;
    /** Internal payments table id (passed through as metadata.payment_id). */
    paymentId: string;
    /** Internal transactions/invoice id (metadata.invoice_id). */
    invoiceId: string;
    /**
     * Référence lisible de la pro-forma, telle qu'elle figure sur le document.
     * C'est ELLE que voit le payeur, sur la page de paiement comme sur son
     * relevé — l'UUID interne ne lui permet aucun rapprochement.
     */
    invoiceRef: string;
    /** Shipowner id (metadata.shipowner_id). */
    shipownerId: string;
    /** URL Stripe redirects to on successful payment. */
    successUrl: string;
    /** URL Stripe redirects to if the buyer cancels. */
    cancelUrl: string;
}

export interface CheckoutSessionResult {
    /** Hosted Stripe Checkout URL to redirect the buyer to. */
    checkoutUrl: string;
    /**
     * Stripe PaymentIntent id, quand Stripe l'a déjà créé. Depuis l'API
     * 2026-04-22, le PaymentIntent d'une Checkout Session n'existe qu'au
     * moment où l'acheteur valide son moyen de paiement : à la création la
     * session renvoie `payment_intent: null`. Les appelants doivent donc
     * retomber sur `stripeSessionId` comme référence externe et laisser le
     * webhook `checkout.session.completed` écrire le PaymentIntent.
     */
    stripePaymentIntentId: string | null;
    /** Stripe Checkout Session id. */
    stripeSessionId: string;
}

/**
 * Creates a Stripe Checkout Session in payment mode for a single-line
 * carbon-tax invoice. Returns the redirect URL plus the Stripe PaymentIntent
 * and Session ids for callers to persist on the local `payments` row.
 *
 * @throws if STRIPE_SECRET_KEY is missing, if Stripe rejects the request,
 * or if the response is missing the expected `url` field.
 */
export async function createCheckoutSession(
    input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        // Managed Payments (Stripe merchant of record) est activé par défaut
        // sur le compte : il refuse `payment_method_types`, exige un
        // `tax_code` produit et encaisse à sa place. Incompatible avec ce
        // rail — la taxe carbone est encaissée par la juridiction, et nos
        // remboursements / réconciliations sont indexés sur le PaymentIntent.
        // On le désactive explicitement session par session.
        managed_payments: { enabled: false },
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: { name: `Carbon Tax Invoice ${input.invoiceRef}` },
                    unit_amount: input.amountUsdMinor,
                },
                quantity: 1,
            },
        ],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: {
            payment_id: input.paymentId,
            invoice_id: input.invoiceId,
            shipowner_id: input.shipownerId,
        },
    });

    if (!session.url) {
        throw new Error('Stripe Checkout Session created without a redirect URL');
    }

    const paymentIntent = session.payment_intent;
    let stripePaymentIntentId: string | null = null;
    if (typeof paymentIntent === 'string') {
        stripePaymentIntentId = paymentIntent;
    } else if (paymentIntent && typeof paymentIntent === 'object' && 'id' in paymentIntent) {
        stripePaymentIntentId = paymentIntent.id;
    }

    return {
        checkoutUrl: session.url,
        stripePaymentIntentId,
        stripeSessionId: session.id,
    };
}

/**
 * Retrieves a PaymentIntent by id. Used by webhook handlers and reconciliation
 * jobs to verify the authoritative status of a payment against Stripe.
 */
export async function retrievePaymentIntent(
    paymentIntentId: string,
): Promise<Stripe.PaymentIntent> {
    const stripe = stripeClient();
    return stripe.paymentIntents.retrieve(paymentIntentId);
}

/**
 * Retrieves a Checkout Session by id. Nécessaire depuis que le PaymentIntent
 * n'est plus créé à l'ouverture de la session : la réconciliation part de la
 * référence `cs_…` stockée sur `payments.external_reference` et lit ici le
 * `payment_intent` / `status` faisant foi.
 */
export async function retrieveCheckoutSession(
    sessionId: string,
): Promise<Stripe.Checkout.Session> {
    const stripe = stripeClient();
    return stripe.checkout.sessions.retrieve(sessionId);
}

/**
 * Creates a refund against an existing Stripe PaymentIntent. Used by
 * Plan 7G executeRefund for the STRIPE rail.
 *
 * @param params.paymentIntent The PaymentIntent id (pi_xxx) to refund against.
 * @param params.amountMinor Amount to refund in USD minor units (cents). Stripe
 * caps this at the original charge amount; passing the full amount = full refund.
 * @returns The Stripe Refund id (re_xxx) + reported status (typically 'succeeded'
 * for instant rails, 'pending' for ACH-style sources).
 * @throws StripeError on API failure (invalid PI, amount exceeds charge, etc.).
 * Callers MUST treat any throw as "refund not placed" — do not advance the
 * local refund row state to EXECUTED in that case.
 */
export async function createRefund(params: {
    paymentIntent: string;
    amountMinor: number;
}): Promise<{ id: string; status: string }> {
    const stripe = stripeClient();
    const refund = await stripe.refunds.create({
        payment_intent: params.paymentIntent,
        amount: params.amountMinor,
    });
    return { id: refund.id, status: refund.status ?? 'unknown' };
}

/**
 * Retrieves a Stripe Refund by id for reconciliation. Used by the
 * `/api/cron/stripe-refund-reconcile-pending` cron (Plan 7H-1) to catch
 * refunds whose webhook delivery was missed.
 *
 * NOTE: this function was lost in the Plan 7G ↔ 7H-1 merge into develop
 * (both plans touched stripeService.ts; the 7H-1 addition was dropped) and
 * restored as part of the post-merge develop-integrity sweep.
 *
 * @returns The refund id, reported status ('succeeded' | 'pending' |
 *   'failed' | 'canceled'), and `failure_reason` when Stripe rejected it.
 * @throws StripeError on API failure (unknown refund id, network, etc.).
 */
export async function retrieveRefund(
    stripeRefundId: string,
): Promise<{ id: string; status: string; failure_reason: string | null }> {
    const stripe = stripeClient();
    const refund = await stripe.refunds.retrieve(stripeRefundId);
    return {
        id: refund.id,
        status: refund.status ?? 'unknown',
        failure_reason: refund.failure_reason ?? null,
    };
}

/**
 * Verifies a Stripe webhook signature and returns the parsed event. Throws
 * if STRIPE_WEBHOOK_SECRET is missing or if the signature is invalid (the
 * SDK throws `Stripe.errors.StripeSignatureVerificationError` in that case).
 *
 * @param payload Raw request body (Buffer or string).
 * @param signature Value of the `Stripe-Signature` request header.
 */
export function verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    const stripe = stripeClient();
    return stripe.webhooks.constructEvent(payload, signature, secret);
}
