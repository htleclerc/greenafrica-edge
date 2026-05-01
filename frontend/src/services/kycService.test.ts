// ─────────────────────────────────────────────────────────────────────────────
// Tests for kycService: encryption strategy detection and IBAN encryption/decryption.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabase = {
    rpc: vi.fn(),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

describe('kycService', () => {
    describe('encryptIban', () => {
        it('detects vault strategy and uses kyc_vault_store', async () => {
            const { encryptIban, _resetStrategy } = await import('./kycService');
            _resetStrategy();

            mockSupabase.rpc.mockImplementation(async (fn: string) => {
                if (fn === 'pg_extension_lookup_kyc') return { data: ['supabase_vault'] };
                if (fn === 'kyc_vault_store') return { data: 'uuid-123' };
                return { data: null };
            });

            const result = await encryptIban('GB82WEST12345698765432');
            expect(result).toBe('uuid-123');
            expect(mockSupabase.rpc).toHaveBeenCalledWith(
                'kyc_vault_store',
                expect.objectContaining({ p_value: 'GB82WEST12345698765432' }),
            );
        });

        it('detects pgsodium strategy and uses kyc_pgsodium_encrypt', async () => {
            const { encryptIban, _resetStrategy } = await import('./kycService');
            _resetStrategy();

            mockSupabase.rpc.mockImplementation(async (fn: string) => {
                if (fn === 'pg_extension_lookup_kyc') return { data: ['pgsodium'] };
                if (fn === 'kyc_pgsodium_encrypt') return { data: 'G0I4V0VFJVK0sdsdfQ==' };
                return { data: null };
            });

            const result = await encryptIban('GB82WEST12345698765432');
            expect(result).toBe('G0I4V0VFJVK0sdsdfQ==');
            expect(mockSupabase.rpc).toHaveBeenCalledWith(
                'kyc_pgsodium_encrypt',
                expect.any(Object),
            );
        });

        it('returns plaintext when no encryption extension available', async () => {
            const { encryptIban, isPlaintextStrategy, _resetStrategy } = await import(
                './kycService'
            );
            _resetStrategy();

            mockSupabase.rpc.mockResolvedValue({ data: [] });

            const result = await encryptIban('GB82WEST12345698765432');
            expect(result).toBe('GB82WEST12345698765432');
            expect(isPlaintextStrategy()).toBe(true);
        });
    });

    describe('decryptIban', () => {
        it('detects vault strategy and retrieves from kyc_vault_retrieve', async () => {
            const { decryptIban, _resetStrategy } = await import('./kycService');
            _resetStrategy();

            mockSupabase.rpc.mockImplementation(async (fn: string) => {
                if (fn === 'pg_extension_lookup_kyc') return { data: ['supabase_vault'] };
                if (fn === 'kyc_vault_retrieve')
                    return { data: 'GB82WEST12345698765432' };
                return { data: null };
            });

            const result = await decryptIban('uuid-123');
            expect(result).toBe('GB82WEST12345698765432');
            expect(mockSupabase.rpc).toHaveBeenCalledWith(
                'kyc_vault_retrieve',
                expect.objectContaining({ p_id: 'uuid-123' }),
            );
        });

        it('detects pgsodium strategy and decrypts using kyc_pgsodium_decrypt', async () => {
            const { decryptIban, _resetStrategy } = await import('./kycService');
            _resetStrategy();

            mockSupabase.rpc.mockImplementation(async (fn: string) => {
                if (fn === 'pg_extension_lookup_kyc') return { data: ['pgsodium'] };
                if (fn === 'kyc_pgsodium_decrypt') return { data: 'GB82WEST12345698765432' };
                return { data: null };
            });

            const result = await decryptIban('G0I4V0VFJVK0sdsdfQ==');
            expect(result).toBe('GB82WEST12345698765432');
            expect(mockSupabase.rpc).toHaveBeenCalledWith(
                'kyc_pgsodium_decrypt',
                expect.any(Object),
            );
        });

        it('returns plaintext when no encryption extension available', async () => {
            const { decryptIban, _resetStrategy } = await import('./kycService');
            _resetStrategy();

            mockSupabase.rpc.mockResolvedValue({ data: [] });

            const result = await decryptIban('plaintext-iban');
            expect(result).toBe('plaintext-iban');
        });
    });

    describe('isPlaintextStrategy', () => {
        it('returns true when strategy is plaintext', async () => {
            const { isPlaintextStrategy, _resetStrategy } = await import('./kycService');
            _resetStrategy();

            mockSupabase.rpc.mockResolvedValue({ data: [] });
            // Trigger detection
            await import('./kycService').then((m) => m.encryptIban('test'));

            expect(isPlaintextStrategy()).toBe(true);
        });

        it('returns false when strategy is vault', async () => {
            const { isPlaintextStrategy, _resetStrategy } = await import('./kycService');
            _resetStrategy();

            mockSupabase.rpc.mockImplementation(async (fn: string) => {
                if (fn === 'pg_extension_lookup_kyc') return { data: ['supabase_vault'] };
                if (fn === 'kyc_vault_store') return { data: 'uuid-123' };
                return { data: null };
            });
            // Trigger detection
            await import('./kycService').then((m) => m.encryptIban('test'));

            expect(isPlaintextStrategy()).toBe(false);
        });
    });
});
