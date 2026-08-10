import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const requireOwnerMock = vi.fn();
const captureOrderMock = vi.fn();
const getOrderMock = vi.fn();
const confirmMock = vi.fn();
const tenantClientMock = vi.fn();

vi.mock('@/lib/auth/requireOwner', () => ({ requireOwner: () => requireOwnerMock() }));
vi.mock('@/services/paypalService', () => ({
    captureOrder: (...a: unknown[]) => captureOrderMock(...a),
    getOrder: (...a: unknown[]) => getOrderMock(...a),
}));
vi.mock('@/services/paypalConfirmation', () => ({
    confirmPaypalPayment: (...a: unknown[]) => confirmMock(...a),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createTenantClient: (...a: unknown[]) => tenantClientMock(...a),
}));

import { GET } from './route';

let paymentRow: Record<string, unknown> | null;
const selectFilters: { col: string; val: unknown }[] = [];

function fakeAdmin() {
    return {
        from: () => ({
            select: () => {
                const chain = {
                    eq: (col: string, val: unknown) => {
                        selectFilters.push({ col, val });
                        return chain;
                    },
                    maybeSingle: async () => ({ data: paymentRow, error: null }),
                };
                return chain;
            },
        }),
    };
}

function req(qs: string): NextRequest {
    return new Request(
        `https://app.test/api/payments/paypal/return${qs}`,
    ) as unknown as NextRequest;
}

/** Destination d'une redirection Next (307 + header Location). */
function locationOf(res: Response): string {
    return res.headers.get('location') ?? '';
}

const CAPTURE_OK = {
    captureId: 'CAP-9',
    orderStatus: 'COMPLETED',
    paidAmount: '1250.00',
    paidCurrency: 'USD',
    payerEmail: 'p@example.com',
};

beforeEach(() => {
    requireOwnerMock.mockReset();
    captureOrderMock.mockReset();
    getOrderMock.mockReset();
    confirmMock.mockReset();
    tenantClientMock.mockReset();
    selectFilters.length = 0;

    paymentRow = { id: 'pay-1', shipowner_id: 'so-1', status: 'PROCESSING' };

    requireOwnerMock.mockResolvedValue({
        userId: 'u-1',
        jurisdictionId: 'jur-1',
        shipowner: { id: 'so-1' },
    });
    tenantClientMock.mockReturnValue(fakeAdmin());
    captureOrderMock.mockResolvedValue(CAPTURE_OK);
    confirmMock.mockResolvedValue({ outcome: 'CONFIRMED', paymentId: 'pay-1' });
});

describe('GET /api/payments/paypal/return — chemin nominal', () => {
    it('capture puis confirme, et redirige vers success', async () => {
        const res = await GET(req('?token=ORDER-1&PayerID=PAYER-1'));

        expect(captureOrderMock).toHaveBeenCalledWith('ORDER-1');
        expect(confirmMock).toHaveBeenCalledOnce();
        expect(confirmMock.mock.calls[0][1]).toEqual({
            orderId: 'ORDER-1',
            captureId: 'CAP-9',
            paidAmount: '1250.00',
            paidCurrency: 'USD',
            payerEmail: 'p@example.com',
        });
        expect(locationOf(res)).toContain('/dashboard/invoices?paypal=success');
    });

    it('utilise un client scope a la juridiction de l armateur', async () => {
        await GET(req('?token=ORDER-1'));
        expect(tenantClientMock).toHaveBeenCalledWith('jur-1');
    });

    it('cherche la ligne par external_reference ET rail=PAYPAL', async () => {
        await GET(req('?token=ORDER-1'));
        expect(selectFilters).toEqual([
            { col: 'external_reference', val: 'ORDER-1' },
            { col: 'rail', val: 'PAYPAL' },
        ]);
    });
});

describe('GET /api/payments/paypal/return — garde-fous', () => {
    it('redirige vers failed si token absent, sans appeler PayPal', async () => {
        const res = await GET(req(''));
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(tenantClientMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=failed');
    });

    it('redirige vers failed si l ordre est inconnu', async () => {
        paymentRow = null;
        const res = await GET(req('?token=ORDER-X'));
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=failed');
    });

    it('redirige vers failed si la ligne appartient a un autre armateur, sans capturer', async () => {
        paymentRow = { id: 'pay-2', shipowner_id: 'so-OTHER', status: 'PROCESSING' };
        const res = await GET(req('?token=ORDER-1'));
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=failed');
    });

    it('redirige vers success si la ligne est deja CONFIRMED (webhook plus rapide)', async () => {
        paymentRow = { id: 'pay-1', shipowner_id: 'so-1', status: 'CONFIRMED' };
        const res = await GET(req('?token=ORDER-1'));
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=success');
    });

    it.each(['REJECTED', 'CANCELLED'])(
        'redirige vers failed si la ligne est deja %s',
        async (status) => {
            paymentRow = { id: 'pay-1', shipowner_id: 'so-1', status };
            const res = await GET(req('?token=ORDER-1'));
            expect(captureOrderMock).not.toHaveBeenCalled();
            expect(locationOf(res)).toContain('paypal=failed');
        },
    );
});

describe('GET /api/payments/paypal/return — echecs de capture', () => {
    it('redirige vers pending si la capture echoue — les filets reprennent la main', async () => {
        captureOrderMock.mockRejectedValue(new Error('PayPal 500'));
        const res = await GET(req('?token=ORDER-1'));
        expect(confirmMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=pending');
    });

    it('retombe sur getOrder si PayPal dit deja capture, puis confirme', async () => {
        captureOrderMock.mockRejectedValue(new Error('ORDER_ALREADY_CAPTURED'));
        getOrderMock.mockResolvedValue({ ...CAPTURE_OK, payerEmail: null });
        const res = await GET(req('?token=ORDER-1'));
        expect(getOrderMock).toHaveBeenCalledWith('ORDER-1');
        expect(confirmMock).toHaveBeenCalledOnce();
        expect(locationOf(res)).toContain('paypal=success');
    });

    it('redirige vers pending si la relecture apres ORDER_ALREADY_CAPTURED echoue', async () => {
        captureOrderMock.mockRejectedValue(new Error('ORDER_ALREADY_CAPTURED'));
        getOrderMock.mockRejectedValue(new Error('PayPal 503'));
        const res = await GET(req('?token=ORDER-1'));
        expect(confirmMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=pending');
    });
});

describe('GET /api/payments/paypal/return — issues de confirmation', () => {
    it('failed si la confirmation rejette le montant', async () => {
        confirmMock.mockResolvedValue({ outcome: 'REJECTED_AMOUNT_MISMATCH', paymentId: 'pay-1' });
        expect(locationOf(await GET(req('?token=ORDER-1')))).toContain('paypal=failed');
    });

    it('failed sur NOT_FOUND', async () => {
        confirmMock.mockResolvedValue({ outcome: 'NOT_FOUND' });
        expect(locationOf(await GET(req('?token=ORDER-1')))).toContain('paypal=failed');
    });

    it('success sur IDEMPOTENT_SKIP (un autre chemin a gagne)', async () => {
        confirmMock.mockResolvedValue({ outcome: 'IDEMPOTENT_SKIP', paymentId: 'pay-1' });
        expect(locationOf(await GET(req('?token=ORDER-1')))).toContain('paypal=success');
    });

    it('pending sur ERROR', async () => {
        confirmMock.mockResolvedValue({ outcome: 'ERROR' });
        expect(locationOf(await GET(req('?token=ORDER-1')))).toContain('paypal=pending');
    });
});
