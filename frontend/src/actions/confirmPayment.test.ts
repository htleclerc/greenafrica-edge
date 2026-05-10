import { describe, it, expect, vi, beforeEach } from 'vitest';

let canConfirmReturn = true;
const updateCalls: any[] = [];
const rpcCalls: { fn: string; args: unknown }[] = [];
const auditCalls: any[] = [];
let overpaymentLedger: any = null;
let transactionsMock: any = null;
let transactionPaidSummaryMock: any = null;
let walletsMock: any = null;
let shipownerMock: any = null;

const mockSupabase = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        if (fn === 'can_confirm_payment') return { data: canConfirmReturn, error: null };
        if (fn === 'recompute_transaction_status') return { data: null, error: null };
        return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
        if (table === 'payments') {
            return {
                update: (payload: any) => {
                    updateCalls.push(payload);
                    return {
                        eq: () => ({
                            select: () => ({
                                single: async () => ({
                                    data: {
                                        id: 'pay-1',
                                        transaction_id: 't-1',
                                        amount_usd_minor: transactionsMock?.amount_usd_minor ?? 10000,
                                        shipowner_id: 'so-1',
                                    },
                                    error: null,
                                }),
                            }),
                        }),
                    };
                },
            };
        }
        if (table === 'transactions') {
            return {
                select: () => ({
                    eq: () => ({
                        single: async () => ({
                            data: transactionsMock || { id: 't-1', tax_amount_usd: 100, shipowner_id: 'so-1' },
                            error: null,
                        }),
                    }),
                }),
            };
        }
        if (table === 'transaction_paid_summary') {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({
                            data: transactionPaidSummaryMock || { transaction_id: 't-1', paid_usd_minor: 0 },
                            error: null,
                        }),
                    }),
                }),
            };
        }
        if (table === 'wallets') {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: walletsMock || { id: 'w-1' }, error: null }),
                    }),
                }),
            };
        }
        if (table === 'wallet_ledger') {
            return {
                insert: async (row: any) => {
                    overpaymentLedger = row;
                    return { error: null };
                },
            };
        }
        if (table === 'audit_logs') {
            return { insert: async (row: any) => { auditCalls.push(row); return { error: null }; } };
        }
        if (table === 'shipowners') {
            return {
                select: () => ({
                    eq: () => ({
                        single: async () => ({
                            data: shipownerMock || { name: 'Acme Shipping', official_email: 'owner@acme.test' },
                            error: null,
                        }),
                    }),
                }),
            };
        }
        return {} as any;
    }),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => ({
        user: { id: 'admin-1', fullName: 'Admin' },
        supabase: mockSupabase,
        error: null,
    })),
}));

vi.mock('@/services/receiptService', () => ({
    generatePaymentReceipt: vi.fn().mockResolvedValue({
        receiptRef: 'RCT-2026-TEST',
        pdfBuffer: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    }),
}));

vi.mock('@/services/emailService', () => ({
    sendPaymentConfirmationEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

beforeEach(() => {
    canConfirmReturn = true;
    updateCalls.length = 0;
    rpcCalls.length = 0;
    auditCalls.length = 0;
    overpaymentLedger = null;
    transactionsMock = null;
    transactionPaidSummaryMock = null;
    walletsMock = null;
    shipownerMock = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    vi.clearAllMocks();
});

describe('confirmPayment', () => {
    it('rejects when can_confirm_payment returns false', async () => {
        canConfirmReturn = false;
        const { confirmPayment } = await import('./confirmPayment');
        await expect(confirmPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174000' }))
            .rejects.toThrow(/not authorized/i);
    });

    it('sets status=CONFIRMED with confirmed_by + confirmed_at and triggers recompute', async () => {
        const { confirmPayment } = await import('./confirmPayment');
        await confirmPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174001' });
        expect(updateCalls[0]).toMatchObject({ status: 'CONFIRMED', confirmed_by: 'admin-1' });
        expect(updateCalls[0].confirmed_at).toBeTruthy();
        expect(rpcCalls.find(c => c.fn === 'recompute_transaction_status')).toBeDefined();
        expect(auditCalls[0]).toMatchObject({
            action: 'TRANSACTION_UPDATED',
            entity_type: 'Payment',
            entity_id: '123e4567-e89b-12d3-a456-426614174001',
        });
    });

    it('splits overpayment: adjusts payment to remaining_due and credits ledger', async () => {
        // Set up mocks for overpayment scenario:
        // dueMinor = 100 * 100 = 10000 cents
        // paidIncludingThis = 16000 (view returns full amount after CONFIRMED)
        // paidBefore = 16000 - 10000 = 6000
        // remaining = 10000 - 6000 = 4000
        // overpay = 10000 - 4000 = 6000
        transactionsMock = { id: 't-1', tax_amount_usd: 100, shipowner_id: 'so-1' };
        transactionPaidSummaryMock = { transaction_id: 't-1', paid_usd_minor: 16000 };
        walletsMock = { id: 'w-1' };

        const { confirmPayment } = await import('./confirmPayment');
        await confirmPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174002' });

        // Should adjust payment.amount_usd_minor to 4000
        const adjust = updateCalls.find(u => u.amount_usd_minor === 4000);
        expect(adjust).toBeDefined();

        // Should insert overpayment ledger entry with 6000 cents excess
        expect(overpaymentLedger).toMatchObject({
            kind: 'OVERPAYMENT_CREDIT',
            amount_signed_usd_minor: 6000,
            wallet_id: 'w-1',
        });
    });

    it('generates a receipt and sends confirmation email after CONFIRMED', async () => {
        const { confirmPayment } = await import('./confirmPayment');
        await confirmPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174003' });

        const { generatePaymentReceipt } = await import('@/services/receiptService');
        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');
        expect(generatePaymentReceipt).toHaveBeenCalledWith(
            expect.anything(),
            '123e4567-e89b-12d3-a456-426614174003',
        );
        expect(sendPaymentConfirmationEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                receiptRef: 'RCT-2026-TEST',
                to: 'owner@acme.test',
            }),
        );
    });

    it('confirmPayment succeeds even when receipt generation fails', async () => {
        const { generatePaymentReceipt } = await import('@/services/receiptService');
        (generatePaymentReceipt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('PDF crash'));

        const { confirmPayment } = await import('./confirmPayment');
        await expect(
            confirmPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174004' }),
        ).resolves.toMatchObject({ ok: true });

        // Email is still attempted (without receipt attachment) — fail-soft both ways
        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');
        expect(sendPaymentConfirmationEmail).toHaveBeenCalled();
    });
});
