import { describe, it, expect } from 'vitest';
import { kycCSchema, kycBEditableSchema } from './kycSchema';

describe('kycCSchema', () => {
    const valid = {
        billing_legal_name: 'Acme Shipping Ltd',
        billing_address_line1: '1 Harbour Rd',
        billing_city: 'Hargeisa',
        billing_postal_code: '00000',
        billing_country_code: 'SO',
        iban: 'SO21000000000000000001',
        swift_bic: 'ABCDSOSX',
        bank_name: 'Bank of Somaliland',
        cgv_accepted: true,
    };
    it('accepte un cas valide', () => {
        expect(kycCSchema.safeParse(valid).success).toBe(true);
    });
    it('rejette un IBAN malformé', () => {
        expect(kycCSchema.safeParse({ ...valid, iban: 'abc' }).success).toBe(false);
    });
    it('rejette un SWIFT malformé', () => {
        expect(kycCSchema.safeParse({ ...valid, swift_bic: 'x' }).success).toBe(false);
    });
    it('exige cgv_accepted = true', () => {
        expect(kycCSchema.safeParse({ ...valid, cgv_accepted: false }).success).toBe(false);
    });
    it('exige un country_code de 2 lettres', () => {
        expect(kycCSchema.safeParse({ ...valid, billing_country_code: 'SOM' }).success).toBe(false);
    });
    it('accepte un RIB vide (coordonnées bancaires optionnelles)', () => {
        expect(kycCSchema.safeParse({ ...valid, iban: '', swift_bic: '', bank_name: '' }).success).toBe(true);
    });
    it('accepte l\'absence totale de coordonnées bancaires', () => {
        const { iban: _i, swift_bic: _s, bank_name: _b, ...rest } = valid;
        void _i; void _s; void _b;
        expect(kycCSchema.safeParse(rest).success).toBe(true);
    });
    it('rejette quand même un IBAN non vide mais malformé', () => {
        expect(kycCSchema.safeParse({ ...valid, iban: 'abc' }).success).toBe(false);
    });
});

describe('kycBEditableSchema', () => {
    it('accepte une édition partielle valide', () => {
        expect(kycBEditableSchema.safeParse({ address: '2 Port Ave', preferred_language: 'en' }).success).toBe(true);
    });
    it('rejette un imo_company_no non 7-chiffres', () => {
        expect(kycBEditableSchema.safeParse({ imo_company_no: '123' }).success).toBe(false);
    });
    it('rejette une langue inconnue', () => {
        expect(kycBEditableSchema.safeParse({ preferred_language: 'zz' }).success).toBe(false);
    });
});
