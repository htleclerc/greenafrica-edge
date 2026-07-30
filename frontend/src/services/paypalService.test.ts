import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock du SDK PayPal ──────────────────────────────────────────────────────
const createOrderMock = vi.fn();
const captureOrderMock = vi.fn();
const getOrderMock = vi.fn();

vi.mock('@paypal/paypal-server-sdk', () => ({
    Client: class {
        constructor(public cfg: unknown) {}
    },
    Environment: { Sandbox: 'Sandbox', Production: 'Production' },
    CheckoutPaymentIntent: { Capture: 'CAPTURE', Authorize: 'AUTHORIZE' },
    PaypalExperienceUserAction: { PayNow: 'PAY_NOW', Continue: 'CONTINUE' },
    OrdersController: class {
        createOrder = createOrderMock;
        captureOrder = captureOrderMock;
        getOrder = getOrderMock;
    },
}));

import {
    paypalConfigured,
    createOrder,
    captureOrder,
    getOrder,
    verifyWebhookSignature,
    __resetPaypalClientForTests,
} from './paypalService';

const ENV_KEYS = [
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'PAYPAL_ENV',
    'PAYPAL_WEBHOOK_ID',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.PAYPAL_CLIENT_ID = 'cid';
    process.env.PAYPAL_CLIENT_SECRET = 'csecret';
    process.env.PAYPAL_ENV = 'sandbox';
    process.env.PAYPAL_WEBHOOK_ID = 'wh-123';
    createOrderMock.mockReset();
    captureOrderMock.mockReset();
    getOrderMock.mockReset();
    __resetPaypalClientForTests();
    vi.unstubAllGlobals();
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

const ORDER_INPUT = {
    amountUsdMinor: 125000,
    transactionId: 'tx-1',
    invoiceRef: 'INV-2026-abc',
    returnUrl: 'https://app/return',
    cancelUrl: 'https://app/cancel',
};

describe('paypalConfigured', () => {
    it('true quand client id et secret sont presents', () => {
        expect(paypalConfigured()).toBe(true);
    });

    it('false quand le secret manque', () => {
        delete process.env.PAYPAL_CLIENT_SECRET;
        expect(paypalConfigured()).toBe(false);
    });

    it('false quand le client id manque', () => {
        delete process.env.PAYPAL_CLIENT_ID;
        expect(paypalConfigured()).toBe(false);
    });
});

describe('createOrder', () => {
    it('extrait orderId et le lien approve', async () => {
        createOrderMock.mockResolvedValue({
            result: {
                id: 'ORDER-1',
                status: 'CREATED',
                links: [
                    { href: 'https://api/orders/ORDER-1', rel: 'self', method: 'GET' },
                    { href: 'https://paypal.com/approve/ORDER-1', rel: 'approve', method: 'GET' },
                ],
            },
        });

        expect(await createOrder(ORDER_INPUT)).toEqual({
            orderId: 'ORDER-1',
            approveUrl: 'https://paypal.com/approve/ORDER-1',
        });
    });

    it('envoie le montant en unites majeures, USD, intent CAPTURE', async () => {
        createOrderMock.mockResolvedValue({
            result: { id: 'ORDER-2', links: [{ rel: 'approve', href: 'https://x' }] },
        });

        await createOrder(ORDER_INPUT);

        const arg = createOrderMock.mock.calls[0][0];
        expect(arg.body.intent).toBe('CAPTURE');
        expect(arg.body.purchaseUnits[0].amount).toEqual({ currencyCode: 'USD', value: '1250.00' });
        expect(arg.body.purchaseUnits[0].customId).toBe('tx-1');
        expect(arg.body.purchaseUnits[0].referenceId).toBe('INV-2026-abc');
    });

    it('passe les URLs de retour via paymentSource.paypal.experienceContext', async () => {
        createOrderMock.mockResolvedValue({
            result: { id: 'ORDER-2b', links: [{ rel: 'approve', href: 'https://x' }] },
        });

        await createOrder(ORDER_INPUT);

        const ctx = createOrderMock.mock.calls[0][0].body.paymentSource.paypal.experienceContext;
        expect(ctx.returnUrl).toBe('https://app/return');
        expect(ctx.cancelUrl).toBe('https://app/cancel');
        expect(ctx.userAction).toBe('PAY_NOW');
        // applicationContext est deprecie cote SDK — on ne doit pas l'utiliser.
        expect(createOrderMock.mock.calls[0][0].body.applicationContext).toBeUndefined();
    });

    it("n'envoie JAMAIS invoiceId (unicite imposee par PayPal -> DUPLICATE_INVOICE_ID au retry)", async () => {
        createOrderMock.mockResolvedValue({
            result: { id: 'ORDER-3', links: [{ rel: 'approve', href: 'https://x' }] },
        });

        await createOrder(ORDER_INPUT);

        expect(createOrderMock.mock.calls[0][0].body.purchaseUnits[0].invoiceId).toBeUndefined();
    });

    it('omet customId pour un top-up (transactionId null)', async () => {
        createOrderMock.mockResolvedValue({
            result: { id: 'ORDER-3b', links: [{ rel: 'approve', href: 'https://x' }] },
        });

        await createOrder({ ...ORDER_INPUT, transactionId: null });

        expect(createOrderMock.mock.calls[0][0].body.purchaseUnits[0].customId).toBeUndefined();
    });

    it('throw si aucun lien approve', async () => {
        createOrderMock.mockResolvedValue({
            result: { id: 'ORDER-4', links: [{ rel: 'self', href: 'x' }] },
        });
        await expect(createOrder(ORDER_INPUT)).rejects.toThrow(/approve/i);
    });

    it('throw si la reponse ne porte pas d id', async () => {
        createOrderMock.mockResolvedValue({
            result: { links: [{ rel: 'approve', href: 'https://x' }] },
        });
        await expect(createOrder(ORDER_INPUT)).rejects.toThrow(/id/i);
    });

    it('throw si les credentials manquent', async () => {
        delete process.env.PAYPAL_CLIENT_ID;
        __resetPaypalClientForTests();
        await expect(createOrder(ORDER_INPUT)).rejects.toThrow(/PAYPAL_CLIENT_ID/);
    });
});

describe('captureOrder', () => {
    it('extrait capture id, montant, devise et e-mail payeur', async () => {
        captureOrderMock.mockResolvedValue({
            result: {
                id: 'ORDER-1',
                status: 'COMPLETED',
                payer: { emailAddress: 'payer@example.com' },
                purchaseUnits: [
                    {
                        payments: {
                            captures: [
                                { id: 'CAP-9', amount: { value: '1250.00', currencyCode: 'USD' } },
                            ],
                        },
                    },
                ],
            },
        });

        expect(await captureOrder('ORDER-1')).toEqual({
            captureId: 'CAP-9',
            orderStatus: 'COMPLETED',
            paidAmount: '1250.00',
            paidCurrency: 'USD',
            payerEmail: 'payer@example.com',
        });
    });

    it('tolere une reponse sans capture (statut seul)', async () => {
        captureOrderMock.mockResolvedValue({ result: { id: 'ORDER-1', status: 'APPROVED' } });
        expect(await captureOrder('ORDER-1')).toEqual({
            captureId: null,
            orderStatus: 'APPROVED',
            paidAmount: null,
            paidCurrency: null,
            payerEmail: null,
        });
    });
});

describe('getOrder', () => {
    it('lit le statut et la capture existante', async () => {
        getOrderMock.mockResolvedValue({
            result: {
                id: 'ORDER-1',
                status: 'COMPLETED',
                purchaseUnits: [
                    {
                        payments: {
                            captures: [
                                { id: 'CAP-1', amount: { value: '10.00', currencyCode: 'USD' } },
                            ],
                        },
                    },
                ],
            },
        });
        const out = await getOrder('ORDER-1');
        expect(out.orderStatus).toBe('COMPLETED');
        expect(out.captureId).toBe('CAP-1');
    });
});

describe('verifyWebhookSignature', () => {
    const HEADERS = {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.paypal.com/cert.pem',
        'paypal-transmission-id': 'tid-1',
        'paypal-transmission-sig': 'sig-1',
        'paypal-transmission-time': '2026-07-30T10:00:00Z',
    };

    it('true quand PayPal repond SUCCESS', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: 'tok', expires_in: 3600 }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ verification_status: 'SUCCESS' }),
            });
        vi.stubGlobal('fetch', fetchMock);

        expect(await verifyWebhookSignature(HEADERS, '{"id":"EV-1"}')).toBe(true);

        const verifyCall = fetchMock.mock.calls[1];
        expect(verifyCall[0]).toContain('/v1/notifications/verify-webhook-signature');
        const body = JSON.parse(verifyCall[1].body as string);
        expect(body.webhook_id).toBe('wh-123');
        expect(body.transmission_id).toBe('tid-1');
        expect(body.webhook_event).toEqual({ id: 'EV-1' });
    });

    it('false quand PayPal repond FAILURE', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ access_token: 'tok', expires_in: 3600 }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ verification_status: 'FAILURE' }),
                }),
        );
        expect(await verifyWebhookSignature(HEADERS, '{"id":"EV-1"}')).toBe(false);
    });

    it('false si PAYPAL_WEBHOOK_ID absent — jamais fail-open', async () => {
        delete process.env.PAYPAL_WEBHOOK_ID;
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect(await verifyWebhookSignature(HEADERS, '{}')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('false si un header de signature manque', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const incomplete = { ...HEADERS, 'paypal-transmission-sig': null };
        expect(await verifyWebhookSignature(incomplete, '{}')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('false si le corps n est pas du JSON', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect(await verifyWebhookSignature(HEADERS, 'not-json')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('false si le token OAuth ne peut pas etre obtenu', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
        expect(await verifyWebhookSignature(HEADERS, '{}')).toBe(false);
    });

    it('false si l appel de verification echoue', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ access_token: 'tok', expires_in: 3600 }),
                })
                .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }),
        );
        expect(await verifyWebhookSignature(HEADERS, '{}')).toBe(false);
    });

    it('reutilise le token OAuth entre deux verifications', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: 'tok', expires_in: 3600 }),
            })
            .mockResolvedValue({ ok: true, json: async () => ({ verification_status: 'SUCCESS' }) });
        vi.stubGlobal('fetch', fetchMock);

        await verifyWebhookSignature(HEADERS, '{"id":"EV-1"}');
        await verifyWebhookSignature(HEADERS, '{"id":"EV-2"}');

        // 1 appel token + 2 appels verify — pas de re-mint du token.
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
