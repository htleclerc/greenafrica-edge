import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('../stripe-reconcile-pending/route', () => ({
    GET: vi.fn(),
}));
vi.mock('../stripe-refund-reconcile-pending/route', () => ({
    GET: vi.fn(),
}));

import { GET as runPaymentReconcile } from '../stripe-reconcile-pending/route';
import { GET as runRefundReconcile } from '../stripe-refund-reconcile-pending/route';

const mockedPayment = vi.mocked(runPaymentReconcile);
const mockedRefund = vi.mocked(runRefundReconcile);

function makeReq(headers: Record<string, string> = {}): Request {
    return new Request('http://x/api/cron/stripe-reconcile-all', {
        method: 'GET',
        headers,
    });
}

function jsonRes(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

describe('GET /api/cron/stripe-reconcile-all', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        process.env.CRON_SECRET = 'topsecret';
    });

    it('returns 401 without correct CRON_SECRET', async () => {
        const res = await GET(
            makeReq({ authorization: 'Bearer wrong' }) as never,
        );
        expect(res.status).toBe(401);
        expect(mockedPayment).not.toHaveBeenCalled();
        expect(mockedRefund).not.toHaveBeenCalled();
    });

    it('returns 401 when CRON_SECRET env is unset (guards against "Bearer undefined")', async () => {
        delete process.env.CRON_SECRET;
        const res = await GET(
            makeReq({ authorization: 'Bearer undefined' }) as never,
        );
        expect(res.status).toBe(401);
    });

    it('invokes both reconcilers and aggregates JSON bodies', async () => {
        mockedPayment.mockResolvedValue(
            jsonRes({ reconciled: 2, results: [] }) as never,
        );
        mockedRefund.mockResolvedValue(
            jsonRes({ checked: 3, reconciled: 1, skipped: 2, errored: 0 }) as never,
        );

        const res = await GET(
            makeReq({ authorization: 'Bearer topsecret' }) as never,
        );

        expect(res.status).toBe(200);
        expect(mockedPayment).toHaveBeenCalledTimes(1);
        expect(mockedRefund).toHaveBeenCalledTimes(1);

        const body = await res.json();
        expect(body).toEqual({
            payments: { status: 200, body: { reconciled: 2, results: [] } },
            refunds: {
                status: 200,
                body: { checked: 3, reconciled: 1, skipped: 2, errored: 0 },
            },
        });
    });

    it('still runs refunds when payments reconciler throws (fail-soft)', async () => {
        mockedPayment.mockRejectedValue(new Error('PaymentService down'));
        mockedRefund.mockResolvedValue(
            jsonRes({ checked: 0, reconciled: 0, skipped: 0, errored: 0 }) as never,
        );

        const res = await GET(
            makeReq({ authorization: 'Bearer topsecret' }) as never,
        );

        expect(res.status).toBe(200);
        expect(mockedRefund).toHaveBeenCalledTimes(1);

        const body = await res.json();
        expect(body.payments).toEqual({ error: 'PaymentService down' });
        expect(body.refunds).toEqual({
            status: 200,
            body: { checked: 0, reconciled: 0, skipped: 0, errored: 0 },
        });
    });

    it('surfaces refund reconciler error without masking payment success', async () => {
        mockedPayment.mockResolvedValue(
            jsonRes({ reconciled: 1, results: [] }) as never,
        );
        mockedRefund.mockRejectedValue(new Error('Stripe API timeout'));

        const res = await GET(
            makeReq({ authorization: 'Bearer topsecret' }) as never,
        );

        const body = await res.json();
        expect(body.payments).toEqual({
            status: 200,
            body: { reconciled: 1, results: [] },
        });
        expect(body.refunds).toEqual({ error: 'Stripe API timeout' });
    });
});
