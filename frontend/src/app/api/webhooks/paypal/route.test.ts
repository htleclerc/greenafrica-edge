import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const verifySigMock = vi.fn();
const captureOrderMock = vi.fn();
const getOrderMock = vi.fn();
const confirmMock = vi.fn();
const rejectMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('@/services/paypalService', () => ({
    verifyWebhookSignature: (...a: unknown[]) => verifySigMock(...a),
    captureOrder: (...a: unknown[]) => captureOrderMock(...a),
    getOrder: (...a: unknown[]) => getOrderMock(...a),
}));
vi.mock('@/services/paypalConfirmation', () => ({
    confirmPaypalPayment: (...a: unknown[]) => confirmMock(...a),
    rejectPaypalPayment: (...a: unknown[]) => rejectMock(...a),
    cancelPaypalPayment: (...a: unknown[]) => cancelMock(...a),
}));
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({}) }));

import { POST } from './route';

const SIG_HEADERS = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.paypal.com/cert.pem',
    'paypal-transmission-id': 'tid-1',
    'paypal-transmission-sig': 'sig-1',
    'paypal-transmission-time': '2026-07-30T10:00:00Z',
};

function req(body: unknown, headers: Record<string, string> = SIG_HEADERS): NextRequest {
    return new Request('https://app.test/api/webhooks/paypal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    }) as unknown as NextRequest;
}

const APPROVED_EVENT = {
    id: 'EV-1',
    event_type: 'CHECKOUT.ORDER.APPROVED',
    resource: { id: 'ORDER-1', status: 'APPROVED' },
};

const CAPTURE_COMPLETED_EVENT = {
    id: 'EV-2',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
        id: 'CAP-9',
        status: 'COMPLETED',
        amount: { value: '1250.00', currency_code: 'USD' },
        supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
    },
};

const CAPTURE_OK = {
    captureId: 'CAP-9',
    orderStatus: 'COMPLETED',
    paidAmount: '1250.00',
    paidCurrency: 'USD',
    payerEmail: 'p@example.com',
};

beforeEach(() => {
    verifySigMock.mockReset().mockResolvedValue(true);
    captureOrderMock.mockReset().mockResolvedValue(CAPTURE_OK);
    getOrderMock.mockReset();
    confirmMock.mockReset().mockResolvedValue({ outcome: 'CONFIRMED', paymentId: 'pay-1' });
    rejectMock.mockReset().mockResolvedValue({ outcome: 'REJECTED' });
    cancelMock.mockReset().mockResolvedValue({ outcome: 'CANCELLED' });
});

describe('signature', () => {
    it('400 si les headers de signature manquent', async () => {
        const res = await POST(req(APPROVED_EVENT, {}));
        expect(res.status).toBe(400);
        expect(verifySigMock).not.toHaveBeenCalled();
        expect(confirmMock).not.toHaveBeenCalled();
    });

    it('400 si un seul header de signature manque', async () => {
        const partial = { ...SIG_HEADERS };
        delete (partial as Record<string, string>)['paypal-transmission-sig'];
        expect((await POST(req(APPROVED_EVENT, partial))).status).toBe(400);
    });

    it('400 si la signature est invalide', async () => {
        verifySigMock.mockResolvedValue(false);
        const res = await POST(req(APPROVED_EVENT));
        expect(res.status).toBe(400);
        expect(confirmMock).not.toHaveBeenCalled();
    });

    it('400 si le corps n est pas du JSON', async () => {
        const bad = new Request('https://app.test/api/webhooks/paypal', {
            method: 'POST',
            headers: SIG_HEADERS,
            body: 'not-json',
        }) as unknown as NextRequest;
        expect((await POST(bad)).status).toBe(400);
    });
});

describe('CHECKOUT.ORDER.APPROVED', () => {
    it('capture puis confirme', async () => {
        const res = await POST(req(APPROVED_EVENT));
        expect(res.status).toBe(200);
        expect(captureOrderMock).toHaveBeenCalledWith('ORDER-1');
        expect(confirmMock.mock.calls[0][1].orderId).toBe('ORDER-1');
        expect((await res.json()).action).toBe('confirmed');
    });

    it('retombe sur getOrder si la capture est deja faite', async () => {
        captureOrderMock.mockRejectedValue(new Error('ORDER_ALREADY_CAPTURED'));
        getOrderMock.mockResolvedValue({ ...CAPTURE_OK, payerEmail: null });
        const res = await POST(req(APPROVED_EVENT));
        expect(res.status).toBe(200);
        expect(confirmMock).toHaveBeenCalledOnce();
    });

    it('200 sans confirmation si la capture echoue vraiment', async () => {
        captureOrderMock.mockRejectedValue(new Error('PayPal 500'));
        const res = await POST(req(APPROVED_EVENT));
        expect(res.status).toBe(200);
        expect(confirmMock).not.toHaveBeenCalled();
        expect((await res.json()).action).toBe('capture_failed');
    });

    it('200 already_paid si un autre chemin avait deja confirme', async () => {
        confirmMock.mockResolvedValue({ outcome: 'IDEMPOTENT_SKIP', paymentId: 'pay-1' });
        expect((await (await POST(req(APPROVED_EVENT))).json()).action).toBe('already_paid');
    });

    it('200 unknown_reference si resource.id est absent', async () => {
        const noId = { ...APPROVED_EVENT, resource: { status: 'APPROVED' } };
        const res = await POST(req(noId));
        expect((await res.json()).action).toBe('unknown_reference');
        expect(captureOrderMock).not.toHaveBeenCalled();
    });
});

describe('PAYMENT.CAPTURE.COMPLETED', () => {
    it('confirme sans recapturer', async () => {
        const res = await POST(req(CAPTURE_COMPLETED_EVENT));
        expect(res.status).toBe(200);
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(confirmMock.mock.calls[0][1]).toEqual({
            orderId: 'ORDER-1',
            captureId: 'CAP-9',
            paidAmount: '1250.00',
            paidCurrency: 'USD',
            payerEmail: null,
        });
    });

    it('200 unknown_reference si l order_id est absent du payload', async () => {
        const noOrder = { ...CAPTURE_COMPLETED_EVENT, resource: { id: 'CAP-9', amount: {} } };
        const res = await POST(req(noOrder));
        expect(res.status).toBe(200);
        expect((await res.json()).action).toBe('unknown_reference');
        expect(confirmMock).not.toHaveBeenCalled();
    });

    it('remonte rejected_amount_mismatch quand la confirmation refuse le montant', async () => {
        confirmMock.mockResolvedValue({ outcome: 'REJECTED_AMOUNT_MISMATCH', paymentId: 'pay-1' });
        const res = await POST(req(CAPTURE_COMPLETED_EVENT));
        expect((await res.json()).action).toBe('rejected_amount_mismatch');
    });
});

describe('echecs et annulations', () => {
    it.each(['PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED'])(
        '%s -> rejet',
        async (event_type) => {
            const res = await POST(
                req({
                    id: 'EV-3',
                    event_type,
                    resource: {
                        id: 'CAP-9',
                        status_details: { reason: 'INSTRUMENT_DECLINED' },
                        supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
                    },
                }),
            );
            expect(res.status).toBe(200);
            expect(rejectMock).toHaveBeenCalledWith(
                expect.anything(),
                'ORDER-1',
                'INSTRUMENT_DECLINED',
            );
            expect((await res.json()).action).toBe('rejected');
        },
    );

    it('retombe sur le type d evenement si aucune raison n est fournie', async () => {
        await POST(
            req({
                id: 'EV-3b',
                event_type: 'PAYMENT.CAPTURE.DENIED',
                resource: {
                    id: 'CAP-9',
                    supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
                },
            }),
        );
        expect(rejectMock.mock.calls[0][2]).toBe('PAYMENT.CAPTURE.DENIED');
    });

    it('CHECKOUT.ORDER.VOIDED -> annulation', async () => {
        const res = await POST(
            req({
                id: 'EV-4',
                event_type: 'CHECKOUT.ORDER.VOIDED',
                resource: { id: 'ORDER-1' },
            }),
        );
        expect(res.status).toBe(200);
        expect(cancelMock).toHaveBeenCalledWith(expect.anything(), 'ORDER-1', 'order voided');
        expect((await res.json()).action).toBe('cancelled');
    });
});

describe('robustesse', () => {
    it('200 sur evenement non gere, sans ecriture', async () => {
        const res = await POST(
            req({ id: 'EV-5', event_type: 'BILLING.SUBSCRIPTION.CREATED', resource: {} }),
        );
        expect(res.status).toBe(200);
        expect((await res.json()).action).toBe('unhandled_event');
        expect(confirmMock).not.toHaveBeenCalled();
        expect(rejectMock).not.toHaveBeenCalled();
        expect(cancelMock).not.toHaveBeenCalled();
    });

    it('200 meme si un handler throw — jamais de tempete de retry', async () => {
        confirmMock.mockRejectedValue(new Error('boom'));
        const res = await POST(req(CAPTURE_COMPLETED_EVENT));
        expect(res.status).toBe(200);
        expect((await res.json()).error).toBe(true);
    });

    it('verifie la signature contre le corps brut, pas contre l objet reparse', async () => {
        await POST(req(APPROVED_EVENT));
        const [headers, rawBody] = verifySigMock.mock.calls[0];
        expect(headers['paypal-transmission-id']).toBe('tid-1');
        expect(rawBody).toBe(JSON.stringify(APPROVED_EVENT));
    });
});
