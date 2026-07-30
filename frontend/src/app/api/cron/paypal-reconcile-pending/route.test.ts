import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const getOrderMock = vi.fn();
const captureOrderMock = vi.fn();
const confirmMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('@/services/paypalService', () => ({
    getOrder: (...a: unknown[]) => getOrderMock(...a),
    captureOrder: (...a: unknown[]) => captureOrderMock(...a),
}));
vi.mock('@/services/paypalConfirmation', () => ({
    confirmPaypalPayment: (...a: unknown[]) => confirmMock(...a),
    cancelPaypalPayment: (...a: unknown[]) => cancelMock(...a),
}));

let pendingRows: Record<string, unknown>[] = [];
let selectError: { message: string } | null = null;
const filters: { op: string; col: string; val: unknown }[] = [];

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: () => ({
            select: () => {
                const chain = {
                    eq: (col: string, val: unknown) => {
                        filters.push({ op: 'eq', col, val });
                        return chain;
                    },
                    lt: (col: string, val: unknown) => {
                        filters.push({ op: 'lt', col, val });
                        return chain;
                    },
                    limit: async () => ({
                        data: selectError ? null : pendingRows,
                        error: selectError,
                    }),
                };
                return chain;
            },
        }),
    }),
}));

import { GET } from './route';

const HOUR = 60 * 60 * 1000;

function req(auth = 'Bearer secret-1'): NextRequest {
    return new Request('https://app.test/api/cron/paypal-reconcile-pending', {
        headers: auth ? { authorization: auth } : {},
    }) as unknown as NextRequest;
}

function row(overrides: Record<string, unknown> = {}) {
    return {
        id: 'pay-1',
        external_reference: 'ORDER-1',
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min
        transaction_id: 'tx-1',
        ...overrides,
    };
}

const order = (orderStatus: string) => ({
    captureId: orderStatus === 'COMPLETED' ? 'CAP-9' : null,
    orderStatus,
    paidAmount: orderStatus === 'COMPLETED' ? '1250.00' : null,
    paidCurrency: orderStatus === 'COMPLETED' ? 'USD' : null,
    payerEmail: null,
});

beforeEach(() => {
    process.env.CRON_SECRET = 'secret-1';
    getOrderMock.mockReset();
    captureOrderMock.mockReset();
    confirmMock.mockReset().mockResolvedValue({ outcome: 'CONFIRMED', paymentId: 'pay-1' });
    cancelMock.mockReset().mockResolvedValue({ outcome: 'CANCELLED' });
    filters.length = 0;
    selectError = null;
    pendingRows = [row()];
});

describe('garde CRON_SECRET', () => {
    it('401 sans header', async () => {
        expect((await GET(req(''))).status).toBe(401);
    });

    it('401 avec un mauvais secret', async () => {
        expect((await GET(req('Bearer nope'))).status).toBe(401);
    });

    it('401 si CRON_SECRET n est pas configure, meme avec "Bearer undefined"', async () => {
        delete process.env.CRON_SECRET;
        expect((await GET(req('Bearer undefined'))).status).toBe(401);
    });
});

describe('selection', () => {
    it('ne prend que les lignes PAYPAL en PROCESSING plus vieilles que le seuil', async () => {
        await GET(req());
        expect(filters).toEqual(
            expect.arrayContaining([
                { op: 'eq', col: 'rail', val: 'PAYPAL' },
                { op: 'eq', col: 'status', val: 'PROCESSING' },
                expect.objectContaining({ op: 'lt', col: 'created_at' }),
            ]),
        );
    });

    it('500 si la selection echoue', async () => {
        selectError = { message: 'db down' };
        expect((await GET(req())).status).toBe(500);
    });

    it('200 avec zero resultat quand rien n est en attente', async () => {
        pendingRows = [];
        const body = await (await GET(req())).json();
        expect(body).toEqual({ reconciled: 0, results: [] });
        expect(getOrderMock).not.toHaveBeenCalled();
    });
});

describe('decisions', () => {
    it('ordre COMPLETED -> confirmation, sans recapturer', async () => {
        getOrderMock.mockResolvedValue(order('COMPLETED'));
        const body = await (await GET(req())).json();
        expect(confirmMock).toHaveBeenCalledOnce();
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(body.results[0].outcome).toBe('CONFIRMED');
    });

    it('ordre APPROVED -> capture puis confirmation', async () => {
        getOrderMock.mockResolvedValue(order('APPROVED'));
        captureOrderMock.mockResolvedValue(order('COMPLETED'));
        const body = await (await GET(req())).json();
        expect(captureOrderMock).toHaveBeenCalledWith('ORDER-1');
        expect(confirmMock).toHaveBeenCalledOnce();
        expect(body.results[0].outcome).toBe('CONFIRMED');
    });

    it('remonte IDEMPOTENT_SKIP tel quel', async () => {
        getOrderMock.mockResolvedValue(order('COMPLETED'));
        confirmMock.mockResolvedValue({ outcome: 'IDEMPOTENT_SKIP', paymentId: 'pay-1' });
        const body = await (await GET(req())).json();
        expect(body.results[0].outcome).toBe('IDEMPOTENT_SKIP');
    });

    it('ordre VOIDED -> annulation', async () => {
        getOrderMock.mockResolvedValue(order('VOIDED'));
        const body = await (await GET(req())).json();
        expect(cancelMock).toHaveBeenCalledWith(expect.anything(), 'ORDER-1', 'order voided');
        expect(body.results[0].outcome).toBe('CANCELLED');
    });

    it('ordre CREATED de moins de 6 h -> laisse en attente', async () => {
        getOrderMock.mockResolvedValue(order('CREATED'));
        const body = await (await GET(req())).json();
        expect(cancelMock).not.toHaveBeenCalled();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(body.results[0].outcome).toBe('STILL_PENDING');
    });

    it('ordre CREATED de plus de 6 h -> annulation pour expiration', async () => {
        pendingRows = [row({ created_at: new Date(Date.now() - 7 * HOUR).toISOString() })];
        getOrderMock.mockResolvedValue(order('CREATED'));
        const body = await (await GET(req())).json();
        expect(cancelMock).toHaveBeenCalledWith(
            expect.anything(),
            'ORDER-1',
            'order expired (6h)',
        );
        expect(body.results[0].outcome).toBe('CANCELLED_EXPIRED');
    });

    it('ligne sans external_reference -> sautee', async () => {
        pendingRows = [row({ external_reference: null })];
        const body = await (await GET(req())).json();
        expect(getOrderMock).not.toHaveBeenCalled();
        expect(body.results[0].outcome).toBe('SKIPPED_NO_ORDER');
    });

    it('une ligne en erreur n empeche pas les suivantes', async () => {
        pendingRows = [row({ id: 'pay-1' }), row({ id: 'pay-2', external_reference: 'ORDER-2' })];
        getOrderMock
            .mockRejectedValueOnce(new Error('PayPal 500'))
            .mockResolvedValueOnce(order('COMPLETED'));
        const body = await (await GET(req())).json();
        expect(body.results[0].outcome).toBe('ERROR');
        expect(body.results[1].outcome).toBe('CONFIRMED');
        expect(body.reconciled).toBe(2);
    });

    it('une capture en echec sur APPROVED donne ERROR sans confirmer', async () => {
        getOrderMock.mockResolvedValue(order('APPROVED'));
        captureOrderMock.mockRejectedValue(new Error('PayPal 503'));
        const body = await (await GET(req())).json();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(body.results[0].outcome).toBe('ERROR');
    });
});
