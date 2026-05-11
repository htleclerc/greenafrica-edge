import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireRole: vi.fn() }));

import { adjustWalletManually } from './adjustWalletManually';
import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';

function setupAdminCtx(role: 'SUPERADMIN' | 'FINANCE_ADMIN', userId = 'admin-1') {
    const single = vi.fn().mockResolvedValue({ data: { id: 'wallet-1' }, error: null });
    const eq = vi.fn(() => ({ single, maybeSingle: single }));
    const select = vi.fn(() => ({ eq }));
    const insertCall = vi.fn().mockResolvedValue({ data: [{ id: 'ledger-new' }], error: null });
    const supabase = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
        from: vi.fn(() => ({ insert: insertCall, select })),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
    (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({ supabase, profile: { role, id: userId }, error: null });
    return { supabase, insertCall };
}

describe('adjustWalletManually', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('rejects FINANCE_ADMIN (SUPERADMIN-only)', async () => {
        (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
            error: new Response('forbidden', { status: 403 }),
        });
        await expect(adjustWalletManually({
            walletId: '11111111-1111-1111-1111-111111111111',
            amountSignedMinor: 10000,
            justification: 'test',
        })).rejects.toThrow(/forbidden/);
    });

    it('inserts ledger row with kind ADMIN_ADJUSTMENT', async () => {
        const { insertCall } = setupAdminCtx('SUPERADMIN');
        await adjustWalletManually({
            walletId: '123e4567-e89b-42d3-a456-426614174000',
            amountSignedMinor: 50000,
            justification: 'Compensation for ops error 2026-05',
        });
        const row = (insertCall as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.kind).toBe('ADMIN_ADJUSTMENT');
        expect(row.amount_signed_usd_minor).toBe(50000);
        expect(row.justification).toBe('Compensation for ops error 2026-05');
    });

    it('rejects zero amount', async () => {
        setupAdminCtx('SUPERADMIN');
        await expect(adjustWalletManually({
            walletId: '11111111-1111-1111-1111-111111111111',
            amountSignedMinor: 0,
            justification: 'test',
        })).rejects.toThrow();
    });

    it('rejects empty justification', async () => {
        setupAdminCtx('SUPERADMIN');
        await expect(adjustWalletManually({
            walletId: '11111111-1111-1111-1111-111111111111',
            amountSignedMinor: 10000,
            justification: '',
        })).rejects.toThrow();
    });
});
