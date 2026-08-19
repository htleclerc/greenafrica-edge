import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateSpy = vi.fn((_p: Record<string, unknown>) => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({ userId: 'u1', jurisdictionId: 'j1', shipowner: { id: 's1', name: 'Acme', imo_company_no: '1234567' } })),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createTenantClient: vi.fn(() => ({ from: vi.fn((t: string) => (t === 'audit_logs' ? { insert: insertSpy } : { update: updateSpy })) })),
}));
vi.mock('@/services/kycService', () => ({ encryptIban: vi.fn(async () => 'ENC'), isInsecureStrategy: () => false }));

beforeEach(() => { updateSpy.mockClear(); insertSpy.mockClear(); });

describe('updateOwnerKycProfile', () => {
    it('remet kyc_level_b_completed_at à null si imo_company_no change', async () => {
        const { updateOwnerKycProfile } = await import('./updateOwnerKycProfile');
        await updateOwnerKycProfile({ identity: { imo_company_no: '7654321' } });
        const patch = updateSpy.mock.calls[0][0];
        expect(patch.imo_company_no).toBe('7654321');
        expect(patch.kyc_level_b_completed_at).toBeNull();
        expect(patch.imo_company_no_verified_at).toBeNull();
    });
    it('chiffre l’IBAN si fourni et ne le fait pas si vide', async () => {
        const { updateOwnerKycProfile } = await import('./updateOwnerKycProfile');
        await updateOwnerKycProfile({ billing: { iban: 'SO21000000000000000001' } });
        expect(updateSpy.mock.calls[0][0].iban).toBe('ENC');
        updateSpy.mockClear();
        await updateOwnerKycProfile({ billing: {} });
        expect('iban' in updateSpy.mock.calls[0][0]).toBe(false);
    });
});
