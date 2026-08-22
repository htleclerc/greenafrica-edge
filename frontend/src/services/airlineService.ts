import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptIban } from './kycService';
import { maskIban } from './armateurService';
import { outstandingUsd } from '@/lib/outstanding';

export interface AirlineCockpitRow {
    id: string;
    name: string;
    country_code: string | null;
    account_state: string;
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
    sanctioned: boolean;
    official_email: string | null;
    iata_code: string | null;
    icao_code: string | null;
    hub_code: string | null;
    aoc_number: string | null;
    proforma_count: number;
    total_invoiced_usd: number;
    total_paid_usd: number;
    total_outstanding_usd: number;
}

export async function listAirlinesCockpit(db: SupabaseClient): Promise<AirlineCockpitRow[]> {
    const { data, error } = await db
        .from('v_compagnie_recouvrement')
        .select('*')
        .order('total_outstanding_usd', { ascending: false });
    if (error) throw new Error(`listAirlinesCockpit: ${error.message}`);
    return (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        country_code: (r.country_code as string | null) ?? null,
        account_state: r.account_state as string,
        is_ofac_sdn: r.is_ofac_sdn as boolean,
        is_un_prohibited: r.is_un_prohibited as boolean,
        sanctioned: r.sanctioned as boolean,
        official_email: (r.official_email as string | null) ?? null,
        iata_code: (r.iata_code as string | null) ?? null,
        icao_code: (r.icao_code as string | null) ?? null,
        hub_code: (r.hub_code as string | null) ?? null,
        aoc_number: (r.aoc_number as string | null) ?? null,
        proforma_count: Number(r.proforma_count),
        total_invoiced_usd: Number(r.total_invoiced_usd),
        total_paid_usd: Number(r.total_paid_usd),
        total_outstanding_usd: Number(r.total_outstanding_usd),
    }));
}

export interface AirlineAircraftRow {
    id: string;
    registration: string | null;
    icao_type: string | null;
    icao24: string | null;
    mtow_kg: number | null;
    compliance_status: string;
}

export interface AirlineProformaRow {
    id: string;
    invoice_ref: string | null;
    created_at: string;
    tax_amount_usd: number;
    /** Gelee par la mig 089 et jamais ecrite — ne pas s'en servir pour un solde. */
    partial_paid_usd: number;
    /** Reste du reel : montant taxe moins les paiements CONFIRMED. */
    outstanding_usd: number;
    status: string;
    content_hash: string | null;
    verify_signature: string | null;
}

export interface AirlinePaymentRow {
    id: string;
    amount_usd_minor: number;
    created_at: string;
    rail: string;
    external_reference: string | null;
    status: string;
}

export interface AirlineReminderRow {
    id: string;
    tier: string;
    sent_at: string;
    debtor_response_type: string;
    escalated_bailiff: boolean;
}

export interface AirlineDetail {
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
    iata_code: string | null;
    icao_code: string | null;
    hub_code: string | null;
    aoc_number: string | null;
    applicable_modes: string[];
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
    aircraft: AirlineAircraftRow[];
    proformas: AirlineProformaRow[];
    payments: AirlinePaymentRow[];
    reminders: AirlineReminderRow[];
}

export async function getAirlineDetail(
    db: SupabaseClient,
    id: string,
    canViewBilling: boolean,
): Promise<AirlineDetail | null> {
    // Garde aviation : iata_code IS NOT NULL. Une ligne maritime → null → notFound côté page.
    const { data: s } = await db
        .from('shipowners')
        .select('*')
        .eq('id', id)
        .not('iata_code', 'is', null)
        .maybeSingle();
    if (!s) return null;

    const [aircraftRes, txRes] = await Promise.all([
        db.from('aircraft').select('id, registration, icao_type, icao24, mtow_kg, compliance_status').eq('operator_id', id),
        db.from('transactions')
          .select('id, invoice_ref, created_at, tax_amount_usd, partial_paid_usd, status, content_hash, verify_signature')
          .eq('shipowner_id', id).eq('document_type', 'PROFORMA').eq('mode', 'AIR')
          .order('created_at', { ascending: false }),
    ]);
    const txIds = (txRes.data ?? []).map((t) => t.id as string);
    const [payRes, remRes] = await Promise.all([
        txIds.length
          ? db.from('payments').select('id, transaction_id, amount_usd_minor, created_at, rail, external_reference, status').in('transaction_id', txIds)
          : Promise.resolve({ data: [] as unknown[] }),
        txIds.length
          ? db.from('collection_reminders').select('id, tier, sent_at, debtor_response_type, escalated_bailiff').in('transaction_id', txIds).order('sent_at', { ascending: true })
          : Promise.resolve({ data: [] as unknown[] }),
    ]);

    // Encaissements CONFIRMED par facture — la seule source du reste du.
    const paidByTxn = new Map<string, number>();
    for (const p of ((payRes.data ?? []) as Record<string, unknown>[])) {
        if (String(p.status) !== 'CONFIRMED') continue;
        const key = String(p.transaction_id ?? '');
        if (!key) continue;
        paidByTxn.set(key, (paidByTxn.get(key) ?? 0) + Number(p.amount_usd_minor ?? 0) / 100);
    }

    const row = s as Record<string, unknown>;
    const str = (k: string) => (row[k] as string | null) ?? null;

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
        ops_email: str('ops_email'),
        finance_email: str('finance_email'),
        phone_e164: str('phone_e164'),
        preferred_language: str('preferred_language'),
        iata_code: str('iata_code'),
        icao_code: str('icao_code'),
        hub_code: str('hub_code'),
        aoc_number: str('aoc_number'),
        applicable_modes: (row.applicable_modes as string[] | null) ?? [],
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
        aircraft: (aircraftRes.data ?? []).map((a) => ({
            id: a.id as string,
            registration: (a.registration as string | null) ?? null,
            icao_type: (a.icao_type as string | null) ?? null,
            icao24: (a.icao24 as string | null) ?? null,
            mtow_kg: a.mtow_kg == null ? null : Number(a.mtow_kg),
            compliance_status: a.compliance_status as string,
        })),
        proformas: (txRes.data ?? []).map((t) => ({
            id: t.id as string, invoice_ref: (t.invoice_ref as string | null) ?? null,
            created_at: t.created_at as string, tax_amount_usd: Number(t.tax_amount_usd),
            partial_paid_usd: Number(t.partial_paid_usd ?? 0),
            outstanding_usd: outstandingUsd(
                t as never, paidByTxn.get(t.id as string) ?? 0,
            ),
            status: t.status as string,
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
