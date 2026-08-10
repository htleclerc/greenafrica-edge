import {
    Client,
    Environment,
    CheckoutPaymentIntent,
    PaypalExperienceUserAction,
    OrdersController,
} from '@paypal/paypal-server-sdk';

/**
 * paypalService — wrapper mince autour du SDK PayPal Server.
 *
 * Isole `@paypal/paypal-server-sdk` dans ce module : le reste du code importe
 * depuis '@/services/paypalService'. Même intention que stripeService.ts —
 * protéger les appelants du churn d'API et centraliser la configuration.
 *
 * Server-only : ne jamais importer depuis un composant client.
 *
 * NOTE — URLs de retour : le SDK 2.x marque `applicationContext` comme déprécié.
 * Les URLs passent par `paymentSource.paypal.experienceContext`.
 *
 * NOTE — vérification de signature webhook : le SDK ne l'expose pas. Elle passe
 * par l'endpoint REST /v1/notifications/verify-webhook-signature, qui exige un
 * token OAuth2 ; d'où le petit cache de token en bas de fichier.
 */

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const LIVE_BASE = 'https://api-m.paypal.com';

function isLive(): boolean {
    return (process.env.PAYPAL_ENV ?? 'sandbox').toLowerCase() === 'live';
}

function apiBase(): string {
    return isLive() ? LIVE_BASE : SANDBOX_BASE;
}

/** True si les credentials nécessaires à un appel sortant sont présentes. */
export function paypalConfigured(): boolean {
    return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

let cachedOrders: OrdersController | null = null;

/**
 * Test-only : vide les caches (client SDK + token OAuth) entre deux tests.
 * Le code de production ne doit jamais l'appeler.
 */
export function __resetPaypalClientForTests(): void {
    cachedOrders = null;
    cachedToken = null;
}

function ordersController(): OrdersController {
    if (cachedOrders) return cachedOrders;
    const id = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!id) throw new Error('PAYPAL_CLIENT_ID is not configured');
    if (!secret) throw new Error('PAYPAL_CLIENT_SECRET is not configured');

    const client = new Client({
        clientCredentialsAuthCredentials: { oAuthClientId: id, oAuthClientSecret: secret },
        environment: isLive() ? Environment.Production : Environment.Sandbox,
    });
    cachedOrders = new OrdersController(client);
    return cachedOrders;
}

export interface PaypalOrder {
    /** Identifiant d'ordre PayPal — devient payments.external_reference. */
    orderId: string;
    /** URL d'approbation vers laquelle rediriger l'armateur. */
    approveUrl: string;
}

export interface PaypalCapture {
    /** Identifiant de capture, null si l'ordre n'est pas encore capturé. */
    captureId: string | null;
    /** Statut de l'ordre : CREATED | APPROVED | COMPLETED | VOIDED … */
    orderStatus: string;
    /** Montant capturé en unités majeures (string PayPal), null si absent. */
    paidAmount: string | null;
    paidCurrency: string | null;
    payerEmail: string | null;
}

/** Narrowing sans `any` sur les réponses du SDK. */
function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function extractCapture(raw: unknown): PaypalCapture {
    const result = asRecord(raw);
    const units = Array.isArray(result.purchaseUnits) ? result.purchaseUnits : [];
    const payments = asRecord(asRecord(units[0]).payments);
    const captures = Array.isArray(payments.captures) ? payments.captures : [];
    const capture = asRecord(captures[0]);
    const amount = asRecord(capture.amount);
    const payer = asRecord(result.payer);

    return {
        captureId: typeof capture.id === 'string' ? capture.id : null,
        orderStatus: typeof result.status === 'string' ? result.status : 'UNKNOWN',
        paidAmount: amount.value != null ? String(amount.value) : null,
        paidCurrency: typeof amount.currencyCode === 'string' ? amount.currencyCode : null,
        payerEmail: typeof payer.emailAddress === 'string' ? payer.emailAddress : null,
    };
}

/**
 * Crée un ordre PayPal en intent CAPTURE et renvoie le lien d'approbation.
 *
 * On n'envoie volontairement PAS `invoiceId` : PayPal en impose l'unicité par
 * compte marchand, donc un armateur qui abandonne puis réessaie recevrait un
 * DUPLICATE_INVOICE_ID. La référence de facture voyage dans `referenceId` +
 * `description`, et `customId` porte l'id de transaction.
 *
 * @throws si les credentials manquent, si PayPal refuse, ou si la réponse ne
 * contient pas d'id ou de lien `approve`.
 */
export async function createOrder(input: {
    amountUsdMinor: number;
    transactionId: string | null;
    invoiceRef: string;
    returnUrl: string;
    cancelUrl: string;
}): Promise<PaypalOrder> {
    const controller = ordersController();
    const value = (input.amountUsdMinor / 100).toFixed(2);

    const response = await controller.createOrder({
        body: {
            intent: CheckoutPaymentIntent.Capture,
            purchaseUnits: [
                {
                    referenceId: input.invoiceRef,
                    ...(input.transactionId ? { customId: input.transactionId } : {}),
                    description: `Carbon Tax Invoice ${input.invoiceRef}`,
                    amount: { currencyCode: 'USD', value },
                },
            ],
            paymentSource: {
                paypal: {
                    experienceContext: {
                        brandName: 'Green Gate',
                        returnUrl: input.returnUrl,
                        cancelUrl: input.cancelUrl,
                        userAction: PaypalExperienceUserAction.PayNow,
                    },
                },
            },
        },
        prefer: 'return=representation',
    });

    const result = asRecord(response.result);
    const orderId = typeof result.id === 'string' ? result.id : null;
    if (!orderId) throw new Error('PayPal order created without an id');

    const links = Array.isArray(result.links) ? result.links : [];
    const approve = links
        .map(asRecord)
        .find((l) => l.rel === 'approve' && typeof l.href === 'string');
    if (!approve) throw new Error('PayPal order created without an approve link');

    return { orderId, approveUrl: String(approve.href) };
}

/**
 * Capture un ordre approuvé.
 *
 * PayPal refuse une double capture avec ORDER_ALREADY_CAPTURED : les appelants
 * traitent cette erreur comme « déjà capturé » et retombent sur getOrder().
 */
export async function captureOrder(orderId: string): Promise<PaypalCapture> {
    const response = await ordersController().captureOrder({
        id: orderId,
        prefer: 'return=representation',
    });
    return extractCapture(response.result);
}

/** Lit l'état autoritatif d'un ordre — utilisé par le webhook et le cron. */
export async function getOrder(orderId: string): Promise<PaypalCapture> {
    const response = await ordersController().getOrder({ id: orderId });
    return extractCapture(response.result);
}

// ── Token OAuth2 (uniquement pour la vérification de signature webhook) ─────

let cachedToken: { value: string; expiresAtMs: number } | null = null;

async function accessToken(): Promise<string | null> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAtMs > now + 60_000) return cachedToken.value;

    const id = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!id || !secret) return null;

    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;

    const body = asRecord(await res.json());
    const token = typeof body.access_token === 'string' ? body.access_token : null;
    if (!token) return null;

    const ttl = typeof body.expires_in === 'number' ? body.expires_in : 300;
    cachedToken = { value: token, expiresAtMs: now + ttl * 1000 };
    return token;
}

const SIG_HEADERS = [
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-sig',
    'paypal-transmission-time',
] as const;

/**
 * Vérifie la signature d'un webhook PayPal via
 * POST /v1/notifications/verify-webhook-signature.
 *
 * Fail-secure : tout élément manquant (webhook id, header, corps illisible) ou
 * toute erreur d'appel renvoie `false`. On ne laisse jamais passer un webhook
 * non vérifié.
 */
export async function verifyWebhookSignature(
    headers: Record<string, string | null>,
    rawBody: string,
): Promise<boolean> {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return false;

    const values: Record<string, string> = {};
    for (const h of SIG_HEADERS) {
        const v = headers[h];
        if (!v) return false;
        values[h] = v;
    }

    let event: unknown;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return false;
    }

    try {
        const token = await accessToken();
        if (!token) return false;

        const res = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                auth_algo: values['paypal-auth-algo'],
                cert_url: values['paypal-cert-url'],
                transmission_id: values['paypal-transmission-id'],
                transmission_sig: values['paypal-transmission-sig'],
                transmission_time: values['paypal-transmission-time'],
                webhook_id: webhookId,
                webhook_event: event,
            }),
        });
        if (!res.ok) return false;

        const body = asRecord(await res.json());
        return body.verification_status === 'SUCCESS';
    } catch {
        return false;
    }
}
