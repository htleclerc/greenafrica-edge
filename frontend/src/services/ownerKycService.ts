import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptIban } from './kycService';
import { maskIban } from './armateurService';

export interface OwnerKycProfile {
    id: string;
    name: string;
    imo_company_no: string | null;
    aoc_number: string | null;
    country_code: string | null;
    address: string | null;
    /** Adresse officielle : destinataire des factures, exclue des copies. */
    official_email: string | null;
    /** Copies de facturation (mig 122). Reçoivent les envois, sans aucun accès. */
    billing_cc_emails: string[];
    ops_email: string | null;
    finance_email: string | null;
    phone_e164: string | null;
    preferred_language: string | null;
    proof_doc_url: string | null;
    proof_doc_type: string | null;
    billing_legal_name: string | null;
    billing_address_line1: string | null;
    billing_address_line2: string | null;
    billing_city: string | null;
    billing_postal_code: string | null;
    billing_country_code: string | null;
    vat_number: string | null;
    iban_masked: string | null;
    swift_bic: string | null;
    bank_name: string | null;
    billing_proof_doc_url: string | null;
    billing_proof_doc_type: string | null;
    kyc_level_b_completed_at: string | null;
    kyc_level_c_completed_at: string | null;
    imo_company_no_verified_at: string | null;
    bDone: boolean;
    cDone: boolean;
}

export async function getOwnerKycProfile(
    db: SupabaseClient,
    shipownerId: string,
): Promise<OwnerKycProfile | null> {
    const { data } = await db.from('shipowners').select('*').eq('id', shipownerId).maybeSingle();
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const str = (k: string) => (row[k] as string | null) ?? null;

    let iban_masked: string | null = null;
    if (typeof row.iban === 'string' && row.iban) {
        try { iban_masked = maskIban(await decryptIban(row.iban)); } catch { iban_masked = null; }
    }

    return {
        id: row.id as string,
        name: row.name as string,
        imo_company_no: str('imo_company_no'),
        aoc_number: str('aoc_number'),
        country_code: str('country_code'),
        address: str('address'),
        official_email: str('official_email'),
        billing_cc_emails: Array.isArray(row.billing_cc_emails)
            ? (row.billing_cc_emails as string[])
            : [],
        ops_email: str('ops_email'),
        finance_email: str('finance_email'),
        phone_e164: str('phone_e164'),
        preferred_language: str('preferred_language'),
        proof_doc_url: str('proof_doc_url'),
        proof_doc_type: str('proof_doc_type'),
        billing_legal_name: str('billing_legal_name'),
        billing_address_line1: str('billing_address_line1'),
        billing_address_line2: str('billing_address_line2'),
        billing_city: str('billing_city'),
        billing_postal_code: str('billing_postal_code'),
        billing_country_code: str('billing_country_code'),
        vat_number: str('vat_number'),
        iban_masked,
        swift_bic: str('swift_bic'),
        bank_name: str('bank_name'),
        billing_proof_doc_url: str('billing_proof_doc_url'),
        billing_proof_doc_type: str('billing_proof_doc_type'),
        kyc_level_b_completed_at: str('kyc_level_b_completed_at'),
        kyc_level_c_completed_at: str('kyc_level_c_completed_at'),
        imo_company_no_verified_at: str('imo_company_no_verified_at'),
        bDone: !!row.kyc_level_b_completed_at,
        cDone: !!row.kyc_level_c_completed_at,
    };
}
