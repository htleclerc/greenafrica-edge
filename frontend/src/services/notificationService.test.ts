import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/services/emailService', () => ({
    sendPaymentConfirmationEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendPaymentRejectedEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendProformaReminderEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendWalletTopupEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendRegistrationApprovalEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendKycRejectedEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendRefundIssuedEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

import { notifyOwner, EMAIL_KINDS } from './notificationService';

function makeClient(opts: { ownerEmail?: string | null; ownerLang?: string } = {}) {
    const insertReturned = { data: { id: 'notif-1' }, error: null };
    const insertCall = vi.fn().mockResolvedValue(insertReturned);
    const select = vi.fn(() => ({ single: vi.fn(() => Promise.resolve(insertReturned)) }));
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }));
    const ownerSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
                data: opts.ownerEmail !== undefined
                    ? { official_email: opts.ownerEmail, preferred_language: opts.ownerLang ?? 'en', name: 'TestCo' }
                    : null,
                error: opts.ownerEmail === undefined ? new Error('not found') : null,
            }),
        })),
    }));
    return {
        from: vi.fn((table: string) => {
            if (table === 'owner_notifications') return { insert: vi.fn(() => ({ select })), update };
            if (table === 'shipowners') return { select: ownerSelect };
            return { select: vi.fn() };
        }),
    } as unknown as SupabaseClient;
}

describe('notifyOwner', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('always INSERTs in-app notification row', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'WALLET_APPLIED',
            params: { amount_usd: 100 },
        });
        expect(client.from).toHaveBeenCalledWith('owner_notifications');
    });

    it('dispatches email for EMAIL_KINDS', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'PAYMENT_REJECTED',
            params: { invoice_ref: 'INV-X', reason: 'bad SWIFT' },
        });
        const { sendPaymentRejectedEmail } = await import('@/services/emailService');
        expect(sendPaymentRejectedEmail).toHaveBeenCalled();
    });

    it('skips email when options.skipEmail = true', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'PAYMENT_RECEIVED',
            params: { invoice_ref: 'INV-X', amount_usd: 100 },
            skipEmail: true,
        });
        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');
        expect(sendPaymentConfirmationEmail).not.toHaveBeenCalled();
    });

    it('skips email when kind not in EMAIL_KINDS', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'WALLET_APPLIED',
            params: {},
        });
        const { sendPaymentRejectedEmail } = await import('@/services/emailService');
        expect(sendPaymentRejectedEmail).not.toHaveBeenCalled();
    });

    it('dispatches sendRefundIssuedEmail for REFUND_ISSUED kind', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'REFUND_ISSUED',
            params: {
                invoice_ref: 'INV-R-1',
                amount_usd: 250,
                refund_rail: 'WALLET',
                executed_at: '2026-05-12T10:00:00Z',
            },
        });
        const { sendRefundIssuedEmail } = await import('@/services/emailService');
        expect(sendRefundIssuedEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'owner@test',
                invoiceRef: 'INV-R-1',
                amountUsd: 250,
                refundRail: 'WALLET',
                executedAt: '2026-05-12T10:00:00Z',
            }),
        );
    });

    it('respects skipEmail for REFUND_ISSUED', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'REFUND_ISSUED',
            params: { invoice_ref: 'INV-R-1', amount_usd: 250, refund_rail: 'WALLET', executed_at: 'x' },
            skipEmail: true,
        });
        const { sendRefundIssuedEmail } = await import('@/services/emailService');
        expect(sendRefundIssuedEmail).not.toHaveBeenCalled();
    });

    it('does not throw when email dispatch fails (fail-soft)', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        const { sendPaymentRejectedEmail } = await import('@/services/emailService');
        (sendPaymentRejectedEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('SMTP down'));
        await expect(notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'PAYMENT_REJECTED',
            params: { invoice_ref: 'INV-X', reason: 'x' },
        })).resolves.toBeDefined();
    });
});
