import { z } from 'zod';

/**
 * Version courante des CGU — persistée à l'acceptation (RGPD Art. 7, preuve de
 * consentement). DOIT correspondre à la version du document réellement affiché
 * (`TermsOfService.version` dans messages/*.json, page /terms-of-service) pour
 * que le consentement soit opposable.
 */
export const CGV_VERSION = 'v3.0.0';

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
    // Coordonnées bancaires optionnelles (ne servent qu'au remboursement d'un
    // trop-perçu / réconciliation finale). Validées uniquement si renseignées :
    // une chaîne vide passe, une valeur non vide doit respecter le format.
    iban: z.string().regex(/^[A-Z0-9]{15,34}$/).or(z.literal('')).optional(),
    swift_bic: z.string().regex(/^[A-Z0-9]{8,11}$/).or(z.literal('')).optional(),
    bank_name: z.string().min(2).max(200).or(z.literal('')).optional(),
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
