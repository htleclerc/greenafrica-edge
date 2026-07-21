import { z } from 'zod';

/** Version courante des CGV — persistée à l'acceptation (RGPD Art. 7, preuve de consentement). */
export const CGV_VERSION = '2026-07-01';

export const ALLOWED_DOC_TYPES = ['CERTIFICATE_OF_INCORPORATION', 'BANK_STATEMENT', 'RIB', 'OTHER'] as const;
export const ALLOWED_LANGS = ['en', 'fr', 'so', 'pt', 'ar', 'sw'] as const;

export const kycCSchema = z.object({
    billing_legal_name: z.string().min(2).max(200),
    billing_address_line1: z.string().min(2).max(200),
    billing_address_line2: z.string().max(200).optional(),
    billing_city: z.string().min(2).max(100),
    billing_postal_code: z.string().min(2).max(20),
    billing_country_code: z.string().length(2),
    vat_number: z.string().max(50).optional(),
    iban: z.string().regex(/^[A-Z0-9]{15,34}$/),
    swift_bic: z.string().regex(/^[A-Z0-9]{8,11}$/),
    bank_name: z.string().min(2).max(200),
    cgv_accepted: z.literal(true),
    billing_proof_doc_storage_path: z.string().min(1).optional(),
    billing_proof_doc_type: z.enum(ALLOWED_DOC_TYPES).optional(),
});
export type KycCInput = z.infer<typeof kycCSchema>;

export const kycBEditableSchema = z.object({
    imo_company_no: z.string().regex(/^\d{7}$/).optional(),
    aoc_number: z.string().min(1).max(50).optional(),
    address: z.string().min(5).max(500).optional(),
    phone_e164: z.string().regex(/^\+\d{8,15}$/).optional(),
    preferred_language: z.enum(ALLOWED_LANGS).optional(),
    ops_email: z.string().email().max(254).optional(),
    finance_email: z.string().email().max(254).optional(),
});
export type KycBEditableInput = z.infer<typeof kycBEditableSchema>;
