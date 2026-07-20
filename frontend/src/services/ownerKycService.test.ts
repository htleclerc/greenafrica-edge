import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./kycService', () => ({ decryptIban: vi.fn(async (s: string) => (s === 'ENC' ? 'SO21000000000000000001' : s)) }));

function db(row: Record<string, unknown> | null) {
    const chain: Record<string, unknown> = {
        select: vi.fn(() => chain), eq: vi.fn(() => chain),
        maybeSingle: vi.fn(() => Promise.resolve({ data: row, error: null })),
    };
    return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

describe('getOwnerKycProfile', () => {
    it('masque l’IBAN côté serveur et dérive bDone/cDone', async () => {
        const { getOwnerKycProfile } = await import('./ownerKycService');
        const p = await getOwnerKycProfile(db({
            id: 's1', name: 'Acme', imo_company_no: '1234567', aoc_number: null, country_code: 'SO',
            address: 'x', ops_email: null, finance_email: null, phone_e164: null, preferred_language: 'en',
            proof_doc_url: null, proof_doc_type: null,
            billing_legal_name: 'Acme', billing_address_line1: '1', billing_address_line2: null,
            billing_city: 'H', billing_postal_code: '0', billing_country_code: 'SO', vat_number: null,
            iban: 'ENC', swift_bic: 'ABCDSOSX', bank_name: 'B', billing_proof_doc_url: null, billing_proof_doc_type: null,
            kyc_level_b_completed_at: '2026-01-01', kyc_level_c_completed_at: null, imo_company_no_verified_at: '2026-01-01',
        }), 's1');
        expect(p?.iban_masked).toBe('•••• 0001');
        expect(p && 'iban' in p).toBe(false);
        expect(p?.bDone).toBe(true);
        expect(p?.cDone).toBe(false);
    });
    it('renvoie null si introuvable', async () => {
        const { getOwnerKycProfile } = await import('./ownerKycService');
        expect(await getOwnerKycProfile(db(null), 'x')).toBeNull();
    });
});
