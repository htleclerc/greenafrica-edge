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
    /** Stripe PaymentIntent id created alongside the session. */
    stripePaymentIntentId: string;
    /** Stripe Checkout Session id. */
    stripeSessionId: string;
}

/**
 * Creates a Stripe Checkout Session in payment mode for a single-line
 * carbon-tax invoice. Returns the redirect URL plus the Stripe PaymentIntent
 * and Session ids for callers to persist on the local `payments` row.
 *
 * @throws if STRIPE_SECRET_KEY is missing, if Stripe rejects the request,
 * or if the response is missing the expected `url` / `payment_intent` fields.
 */
export async function createCheckoutSession(
    input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: { name: `Carbon Tax Invoice ${input.invoiceId}` },
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
    let stripePaymentIntentId: string;
    if (typeof paymentIntent === 'string') {
        stripePaymentIntentId = paymentIntent;
    } else if (paymentIntent && typeof paymentIntent === 'object' && 'id' in paymentIntent) {
        stripePaymentIntentId = paymentIntent.id;
    } else {
        throw new Error('Stripe Checkout Session created without a PaymentIntent');
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
 * Retrieves a Refund by id. Used by the refund-reconcile cron (Plan 7H-1)
 * to verify the authoritative status of a refund against Stripe when the
 * `charge.refunded` webhook may have been missed.
 *
 * Returned shape is a narrow projection — we only care about status +
 * failure_reason. Callers must not assume any other field is present.
 */
export interface RetrievedRefund {
    id: string;
    /** Stripe refund status: 'succeeded' | 'pending' | 'failed' | 'canceled' | 'requires_action' | string. */
    status: string;
    /** Stripe failure_reason string (or null if not failed / not provided). */
    failure_reason: string | null;
}

export async function retrieveRefund(stripeRefundId: string): Promise<RetrievedRefund> {
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
