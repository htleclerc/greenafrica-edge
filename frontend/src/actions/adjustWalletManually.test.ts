import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertCall = vi.fn().mockResolvedValue({ data: [{ id: 'ledger-new' }], error: null });
const mockAdmin = {
    from: vi.fn(() => ({ insert: insertCall })),
};

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockAdmin) }));
vi.mock('@/lib/auth/requireRole', () => ({ requireRole: vi.fn() }));

import { adjustWalletManually } from './adjustWalletManually';
import { requireRole } from '@/lib/auth/requireRole';

function setupAdminCtx(role: 'SUPERADMIN' | 'FINANCE_ADMIN', userId = 'admin-1') {
    (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: { id: userId, role },
        supabase: mockAdmin,
        error: null,
    });
}

describe('adjustWalletManually', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        insertCall.mockClear();
        insertCall.mockResolvedValue({ data: [{ id: 'ledger-new' }], error: null });
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    });

    it('rejects FINANCE_ADMIN (SUPERADMIN-only)', async () => {
        (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
            user: null,
            supabase: null,
            error: new Response('forbidden', { status: 403 }),
        });
        await expect(adjustWalletManually({
            walletId: '11111111-1111-1111-1111-111111111111',
            amountSignedMinor: 10000,
            justification: 'test',
        })).rejects.toThrow(/forbidden/);
    });

    it('inserts ledger row with kind ADMIN_ADJUSTMENT', async () => {
        setupAdminCtx('SUPERADMIN');
        await adjustWalletManually({
            walletId: '123e4567-e89b-42d3-a456-426614174000',
            amountSignedMinor: 50000,
            justification: 'Compensation for ops error 2026-05',
        });
        const row = insertCall.mock.calls[0][0];
        expect(row.kind).toBe('ADMIN_ADJUSTMENT');
        expect(row.amount_signed_usd_minor).toBe(50000);
        expect(row.justification).toBe('Compensation for ops error 2026-05');
        expect(row.created_by).toBe('admin-1');
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

    it('emits a structured wallet_manually_adjusted log event (Plan 7H-3)', async () => {
        setupAdminCtx('SUPERADMIN');
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await adjustWalletManually({
            walletId: '123e4567-e89b-42d3-a456-426614174000',
            amountSignedMinor: 50000,
            justification: 'Compensation for ops error 2026-05',
        });
        const calls = consoleSpy.mock.calls.map((c) => String(c[0]));
        expect(calls.some((c) => c.includes('"event":"wallet_manually_adjusted"'))).toBe(true);
        // Sensitive justification text MUST NOT appear in logs (only length is logged).
        expect(calls.some((c) => c.includes('Compensation for ops error'))).toBe(false);
        consoleSpy.mockRestore();
    });
});
