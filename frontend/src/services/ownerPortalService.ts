// ─────────────────────────────────────────────────────────────────────────────
// Shipowner portal — read helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// Counter + listing queries used by /owner/dashboard and downstream pages.
// All queries rely on the SHIPOWNER RLS policies (mig 033 + 039) — the
// service does NOT filter by owner explicitly; auth.uid() resolution +
// RLS does the work. This keeps a single source of truth for visibility
// and avoids the "service forgot to filter" class of bugs.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';

export interface OwnerCounters {
    activeVessels: number;
    openAlerts: number;
    unpaidProformaUsd: number;
    paidYtdUsd: number;
}

export async function getOwnerCounters(db: SupabaseClient): Promise<OwnerCounters> {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString();

    const [vesselsRes, alertsRes, unpaidRes, paidYtdRes] = await Promise.all([
        // Vessels — count active (not deleted) tied to this owner. RLS scopes.
        db.from('vessels').select('id', { count: 'exact', head: true }),
        // Alerts in flight: anything between detection and reconciliation
        db.from('arrival_alerts')
            .select('id', { count: 'exact', head: true })
            .in('status', ['DETECTED', 'MATCHED_AUTO', 'UNCLAIMED', 'PROFORMA_SENT', 'ARRIVED', 'DEPARTED_EEZ']),
        // Unpaid PROFORMAs — sum tax_amount_usd. Use small page; finance scale tolerated.
        db.from('transactions')
            .select('tax_amount_usd')
            .eq('document_type', 'PROFORMA')
            .eq('status', 'PENDING'),
        // Paid YTD — sum across FINAL/COMPLEMENT statuses paid this calendar year
        db.from('transactions')
            .select('tax_amount_usd, paid_at')
            .in('document_type', ['FINAL', 'COMPLEMENT'])
            .eq('status', 'PAID')
            .gte('paid_at', startOfYear),
    ]);

    const sum = (rows: { tax_amount_usd: number | string | null }[] | null) =>
        (rows ?? []).reduce((acc, r) => acc + Number(r.tax_amount_usd ?? 0), 0);

    return {
        activeVessels: vesselsRes.count ?? 0,
        openAlerts: alertsRes.count ?? 0,
        unpaidProformaUsd: sum(unpaidRes.data),
        paidYtdUsd: sum(paidYtdRes.data),
    };
}

export function formatUsd(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(amount);
}
