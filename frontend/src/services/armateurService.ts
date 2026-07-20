import type { SupabaseClient } from '@supabase/supabase-js';

export interface ArmateurCockpitRow {
    id: string;
    name: string;
    country_code: string | null;
    account_state: string;
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
    sanctioned: boolean;
    official_email: string | null;
    imo_company_no: string | null;
    proforma_count: number;
    total_invoiced_usd: number;
    total_paid_usd: number;
    total_outstanding_usd: number;
}

export async function listArmateursCockpit(db: SupabaseClient): Promise<ArmateurCockpitRow[]> {
    const { data, error } = await db
        .from('v_armateur_recouvrement')
        .select('*')
        .order('total_outstanding_usd', { ascending: false });
    if (error) throw new Error(`listArmateursCockpit: ${error.message}`);
    // Postgres renvoie les NUMERIC/BIGINT en string via PostgREST → normaliser en number.
    return (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        country_code: (r.country_code as string | null) ?? null,
        account_state: r.account_state as string,
        is_ofac_sdn: r.is_ofac_sdn as boolean,
        is_un_prohibited: r.is_un_prohibited as boolean,
        sanctioned: r.sanctioned as boolean,
        official_email: (r.official_email as string | null) ?? null,
        imo_company_no: (r.imo_company_no as string | null) ?? null,
        proforma_count: Number(r.proforma_count),
        total_invoiced_usd: Number(r.total_invoiced_usd),
        total_paid_usd: Number(r.total_paid_usd),
        total_outstanding_usd: Number(r.total_outstanding_usd),
    }));
}

export function maskIban(iban: string | null): string | null {
    if (!iban) return null;
    const tail = iban.slice(-4);
    return `•••• ${tail}`;
}

export interface ArmateurProformaRow {
    id: string;
    invoice_ref: string | null;
    created_at: string;
    tax_amount_usd: number;
    partial_paid_usd: number;
    status: string;
    content_hash: string | null;
    verify_signature: string | null;
}

export interface ArmateurVesselRow {
    id: string;
    imo_number: string;
    name: string;
    category: string;
    gross_tonnage_dwt: number;
    flag_code: string | null;
}

export interface ArmateurPaymentRow {
    id: string;
    amount_usd_minor: number;
    created_at: string;
    rail: string;
    external_reference: string | null;
    status: string;
}

export interface ArmateurReminderRow {
    id: string;
    tier: string;
    sent_at: string;
    debtor_response_type: string;
    escalated_bailiff: boolean;
}

export interface ArmateurDetail {
    id: string;
    name: string;
    aliases: string[];
    country_code: string | null;
    address: string | null;
    official_email: string | null;
    official_email_source: string | null;
    ops_email: string | null;
    finance_email: string | null;
    phone_e164: string | null;
    preferred_language: string | null;
    imo_company_no: string | null;
    equasis_id: string | null;
    notes: string | null;
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
    account_state: string;
    kyc_level_b_completed_at: string | null;
    kyc_level_c_completed_at: string | null;
    billing_legal_name: string | null;
    billing_city: string | null;
    billing_country_code: string | null;
    vat_number: string | null;
    iban: string | null;
    swift_bic: string | null;
    bank_name: string | null;
    vessels: ArmateurVesselRow[];
    proformas: ArmateurProformaRow[];
    payments: ArmateurPaymentRow[];
    reminders: ArmateurReminderRow[];
}

export async function getArmateurDetail(db: SupabaseClient, id: string): Promise<ArmateurDetail | null> {
    const { data: s } = await db.from('shipowners').select('*').eq('id', id).maybeSingle();
    if (!s) return null;

    const [vesselsRes, txRes] = await Promise.all([
        db.from('vessels').select('id, imo_number, name, category, gross_tonnage_dwt, flag_code').eq('shipowner_id', id),
        db.from('transactions').select('id, invoice_ref, created_at, tax_amount_usd, partial_paid_usd, status, content_hash, verify_signature')
          .eq('shipowner_id', id).eq('document_type', 'PROFORMA').eq('mode', 'MARITIME')
          .order('created_at', { ascending: false }),
    ]);
    const txIds = (txRes.data ?? []).map((t) => t.id as string);
    const [payRes, remRes] = await Promise.all([
        txIds.length
          ? db.from('payments').select('id, amount_usd_minor, created_at, rail, external_reference, status').in('transaction_id', txIds)
          : Promise.resolve({ data: [] as unknown[] }),
        txIds.length
          ? db.from('collection_reminders').select('id, tier, sent_at, debtor_response_type, escalated_bailiff').in('transaction_id', txIds).order('sent_at', { ascending: true })
          : Promise.resolve({ data: [] as unknown[] }),
    ]);

    // Narrowing explicite depuis les lignes shipowners (types manuels — pas de any).
    const row = s as Record<string, unknown>;
    const str = (k: string) => (row[k] as string | null) ?? null;
    return {
        id: row.id as string,
        name: row.name as string,
        aliases: (row.aliases as string[] | null) ?? [],
        country_code: str('country_code'),
        address: str('address'),
        official_email: str('official_email'),
        official_email_source: str('official_email_source'),
        ops_email: str('ops_email'),
        finance_email: str('finance_email'),
        phone_e164: str('phone_e164'),
        preferred_language: str('preferred_language'),
        imo_company_no: str('imo_company_no'),
        equasis_id: str('equasis_id'),
        notes: str('notes'),
        is_ofac_sdn: !!row.is_ofac_sdn,
        is_un_prohibited: !!row.is_un_prohibited,
        account_state: row.account_state as string,
        kyc_level_b_completed_at: str('kyc_level_b_completed_at'),
        kyc_level_c_completed_at: str('kyc_level_c_completed_at'),
        billing_legal_name: str('billing_legal_name'),
        billing_city: str('billing_city'),
        billing_country_code: str('billing_country_code'),
        vat_number: str('vat_number'),
        iban: str('iban'),
        swift_bic: str('swift_bic'),
        bank_name: str('bank_name'),
        vessels: (vesselsRes.data ?? []).map((v) => ({
            id: v.id as string, imo_number: v.imo_number as string, name: v.name as string,
            category: v.category as string, gross_tonnage_dwt: Number(v.gross_tonnage_dwt),
            flag_code: (v.flag_code as string | null) ?? null,
        })),
        proformas: (txRes.data ?? []).map((t) => ({
            id: t.id as string, invoice_ref: (t.invoice_ref as string | null) ?? null,
            created_at: t.created_at as string, tax_amount_usd: Number(t.tax_amount_usd),
            partial_paid_usd: Number(t.partial_paid_usd ?? 0), status: t.status as string,
            content_hash: (t.content_hash as string | null) ?? null,
            verify_signature: (t.verify_signature as string | null) ?? null,
        })),
        payments: ((payRes.data ?? []) as Record<string, unknown>[]).map((p) => ({
            id: p.id as string, amount_usd_minor: Number(p.amount_usd_minor),
            created_at: p.created_at as string, rail: p.rail as string,
            external_reference: (p.external_reference as string | null) ?? null, status: p.status as string,
        })),
        reminders: ((remRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
            id: r.id as string, tier: r.tier as string, sent_at: r.sent_at as string,
            debtor_response_type: r.debtor_response_type as string, escalated_bailiff: !!r.escalated_bailiff,
        })),
    };
}
