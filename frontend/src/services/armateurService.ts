import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptIban } from './kycService';

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
    overdue_count: number;
    next_due_date: string | null;
    last_auto_tier: string | null;
    last_reminder_at: string | null;
    latest_response_type: string | null;
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
        overdue_count: Number(r.overdue_count ?? 0),
        next_due_date: (r.next_due_date as string | null) ?? null,
        last_auto_tier: (r.last_auto_tier as string | null) ?? null,
        last_reminder_at: (r.last_reminder_at as string | null) ?? null,
        latest_response_type: (r.latest_response_type as string | null) ?? null,
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
    due_date: string | null;
    collections_status: string | null;
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
    billing_cc_emails: string[];
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
    iban_masked: string | null;
    swift_bic: string | null;
    bank_name: string | null;
    anonymized_at: string | null;
    totals: {
        invoicedUsd: number;
        paidUsd: number;
        outstandingUsd: number;
        overdueCount: number;
        nextDueDate: string | null;
    };
    vessels: ArmateurVesselRow[];
    proformas: ArmateurProformaRow[];
    payments: ArmateurPaymentRow[];
    reminders: ArmateurReminderRow[];
}

export async function getArmateurDetail(
    db: SupabaseClient,
    id: string,
    canViewBilling: boolean,
): Promise<ArmateurDetail | null> {
    const { data: s } = await db.from('shipowners').select('*').eq('id', id).is('iata_code', null).maybeSingle();
    if (!s) return null;

    const [vesselsRes, txRes, recRes] = await Promise.all([
        db.from('vessels').select('id, imo_number, name, category, gross_tonnage_dwt, flag_code').eq('shipowner_id', id),
        db.from('transactions').select('id, invoice_ref, created_at, tax_amount_usd, partial_paid_usd, status, due_date, collections_status, content_hash, verify_signature')
          .eq('shipowner_id', id).eq('document_type', 'PROFORMA').eq('mode', 'MARITIME')
          .order('created_at', { ascending: false }),
        // Totaux de compte : déjà agrégés par la vue (Task 1, mig 121) — on ne les
        // recalcule pas ici. Repli à zéro/valeurs neutres si la ligne est absente
        // (ex: shipowner sans aucune transaction ne produit pas forcément de ligne).
        db.from('v_armateur_recouvrement')
          .select('total_invoiced_usd, total_paid_usd, total_outstanding_usd, overdue_count, next_due_date')
          .eq('id', id).maybeSingle(),
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

    // PostgREST renvoie les NUMERIC/BIGINT en string → Number(...). Repli à zéro/null
    // si la vue ne renvoie aucune ligne pour cet armateur (ex : aucune transaction).
    const recRow = recRes.data as Record<string, unknown> | null;
    const totals = {
        invoicedUsd: Number(recRow?.total_invoiced_usd ?? 0),
        paidUsd: Number(recRow?.total_paid_usd ?? 0),
        outstandingUsd: Number(recRow?.total_outstanding_usd ?? 0),
        overdueCount: Number(recRow?.overdue_count ?? 0),
        nextDueDate: (recRow?.next_due_date as string | null | undefined) ?? null,
    };

    // L'IBAN est chiffré au repos (mig 047) — jamais renvoyé brut au client.
    // Déchiffré + masqué côté serveur, et seulement pour les rôles habilités à voir la facturation.
    let iban_masked: string | null = null;
    if (canViewBilling && typeof row.iban === 'string' && row.iban) {
        try {
            iban_masked = maskIban(await decryptIban(row.iban));
        } catch {
            iban_masked = null;
        }
    }

    return {
        id: row.id as string,
        name: row.name as string,
        aliases: (row.aliases as string[] | null) ?? [],
        country_code: str('country_code'),
        address: str('address'),
        official_email: str('official_email'),
        official_email_source: str('official_email_source'),
        billing_cc_emails: (row.billing_cc_emails as string[] | null) ?? [],
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
        iban_masked,
        swift_bic: str('swift_bic'),
        bank_name: str('bank_name'),
        anonymized_at: str('anonymized_at'),
        totals,
        vessels: (vesselsRes.data ?? []).map((v) => ({
            id: v.id as string, imo_number: v.imo_number as string, name: v.name as string,
            category: v.category as string, gross_tonnage_dwt: Number(v.gross_tonnage_dwt),
            flag_code: (v.flag_code as string | null) ?? null,
        })),
        proformas: (txRes.data ?? []).map((t) => ({
            id: t.id as string, invoice_ref: (t.invoice_ref as string | null) ?? null,
            created_at: t.created_at as string, tax_amount_usd: Number(t.tax_amount_usd),
            partial_paid_usd: Number(t.partial_paid_usd ?? 0), status: t.status as string,
            due_date: (t.due_date as string | null) ?? null,
            collections_status: (t.collections_status as string | null) ?? null,
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
