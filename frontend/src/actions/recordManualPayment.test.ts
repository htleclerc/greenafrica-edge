import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(),
}));
vi.mock('@/services/fxRateService', () => ({
    lockRate: vi.fn(async () => ({ rate: 1, source: 'TEST', lockedAt: '2026-05-10T00:00:00Z' })),
}));

import { recordManualPayment } from './recordManualPayment';
import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';

function makeAdminCtx(role: 'FINANCE_ADMIN' | 'SUPERADMIN' = 'FINANCE_ADMIN', userId = 'admin-1') {
    const single = vi.fn().mockResolvedValue({ data: { id: 'pay-new', status: 'INITIATED', transaction_id: null, amount_usd_minor: 50000 }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const supabase = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
        from: vi.fn(() => ({ insert })),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
    (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
        supabase,
        user: { id: userId, role },
        profile: { role, id: userId },
        error: null,
    });
    return { supabase, insert };
}

describe('recordManualPayment', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('inserts INITIATED for CHEQUE when confirmImmediately=false', async () => {
        const { insert } = makeAdminCtx();
        const result = await recordManualPayment({
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            transactionId: '123e4567-e89b-42d3-a456-426614174111',
            rail: 'CHEQUE',
            amount: '500.00',
            currency: 'USD',
            railDetails: { cheque_number: '12345', bank_name: 'BoA' },
            confirmImmediately: false,
        });
        expect(result.id).toBe('pay-new');
        const row = (insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.status).toBe('INITIATED');
        expect(row.confirmed_by).toBeNull();
    });

    it('inserts CONFIRMED for CHEQUE when confirmImmediately=true', async () => {
        const { insert } = makeAdminCtx();
        await recordManualPayment({
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            transactionId: '123e4567-e89b-42d3-a456-426614174111',
            rail: 'CHEQUE',
            amount: '500.00',
            currency: 'USD',
            railDetails: { cheque_number: '12345' },
            confirmImmediately: true,
        });
        const row = (insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.status).toBe('CONFIRMED');
        expect(row.confirmed_by).toBe('admin-1');
        expect(row.confirmed_at).toBeTruthy();
    });

    it('FORCES INITIATED for CASH even when confirmImmediately=true (4-eyes)', async () => {
        const { insert } = makeAdminCtx();
        await recordManualPayment({
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            transactionId: '123e4567-e89b-42d3-a456-426614174111',
            rail: 'CASH',
            amount: '100.00',
            currency: 'USD',
            railDetails: { receipt_number: 'R-001' },
            confirmImmediately: true, // ignored for CASH
        });
        const row = (insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.status).toBe('INITIATED');
        expect(row.confirmed_by).toBeNull();
    });

    it('rejects unknown rail', async () => {
        makeAdminCtx();
        await expect(recordManualPayment({
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            transactionId: '123e4567-e89b-42d3-a456-426614174111',
            rail: 'INVALID' as never,
            amount: '100',
            currency: 'USD',
            railDetails: {},
            confirmImmediately: false,
        })).rejects.toThrow();
    });

    it('FORCES INITIATED for NETTING when caller is FINANCE_ADMIN (SUPERADMIN-only rule)', async () => {
        const { insert } = makeAdminCtx('FINANCE_ADMIN');
        await recordManualPayment({
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            transactionId: '123e4567-e89b-42d3-a456-426614174111',
            rail: 'NETTING',
            amount: '1000.00',
            currency: 'USD',
            railDetails: { counterparty: 'X', net_settlement_ref: 'Y' },
            confirmImmediately: true, // forced ignored — FINANCE_ADMIN can't confirm NETTING
        });
        const row = (insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.status).toBe('INITIATED');
        expect(row.confirmed_by).toBeNull();
    });

    it('allows CONFIRMED for NETTING when caller is SUPERADMIN', async () => {
        const { insert } = makeAdminCtx('SUPERADMIN');
        await recordManualPayment({
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            transactionId: '123e4567-e89b-42d3-a456-426614174111',
            rail: 'NETTING',
            amount: '1000.00',
            currency: 'USD',
            railDetails: { counterparty: 'X', net_settlement_ref: 'Y' },
            confirmImmediately: true,
        });
        const row = (insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.status).toBe('CONFIRMED');
        expect(row.confirmed_by).toBeTruthy();
    });

    it('rejects when caller is not FINANCE_ADMIN/SUPERADMIN', async () => {
        (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
            error: new Response('forbidden', { status: 403 }),
        });
        await expect(recordManualPayment({
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            transactionId: '123e4567-e89b-42d3-a456-426614174111',
            rail: 'CHEQUE',
            amount: '100',
            currency: 'USD',
            railDetails: {},
            confirmImmediately: false,
        })).rejects.toThrow(/forbidden|unauthorized/i);
    });
});
