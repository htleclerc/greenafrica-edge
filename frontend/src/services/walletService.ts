import type { SupabaseClient } from '@supabase/supabase-js';

export interface WalletRow {
    id: string;
    shipowner_id: string;
    balance_usd_minor: number;
    auto_apply_to_proforma: boolean;
    created_at: string;
    updated_at: string;
}

export type LedgerKind =
    | 'TOPUP'
    | 'OVERPAYMENT_CREDIT'
    | 'REFUND_CREDIT'
    | 'PROFORMA_APPLY'
    | 'ADMIN_ADJUSTMENT'
    | 'FX_DIFFERENCE';

export interface LedgerRow {
    id: string;
    wallet_id: string;
    amount_signed_usd_minor: number;
    kind: LedgerKind;
    payment_id: string | null;
    transaction_id: string | null;
    refund_id: string | null;
    created_by: string;
    justification: string | null;
    created_at: string;
}

export interface LedgerFilters {
    kinds: LedgerKind[];   // empty = all
    offset: number;
    limit: number;
}

export interface NextTaxPrediction {
    estimated_count_30d: number;
    estimated_amount_30d_usd: number;
    confidence: 'low' | 'medium' | 'high';
}

/**
 * Get the wallet row for a shipowner. Returns null if the shipowner has no wallet yet.
 */
export async function getWalletForOwner(
    client: SupabaseClient,
    shipownerId: string,
): Promise<WalletRow | null> {
    const { data, error } = await client
        .from('wallets')
        .select('id, shipowner_id, balance_usd_minor, auto_apply_to_proforma, created_at, updated_at')
        .eq('shipowner_id', shipownerId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as WalletRow | null;
}

/**
 * List ledger entries for a wallet, newest first, paginated.
 * Filters: kinds (empty = all).
 */
export async function listLedgerEntries(
    client: SupabaseClient,
    walletId: string,
    filters: LedgerFilters,
): Promise<LedgerRow[]> {
    let q = client
        .from('wallet_ledger')
        .select('*')
        .eq('wallet_id', walletId);
    if (filters.kinds.length > 0) {
        q = q.in('kind', filters.kinds);
    }
    const { data, error } = await q
        .order('created_at', { ascending: false })
        .range(filters.offset, filters.offset + filters.limit - 1);
    if (error) throw new Error(error.message);
    return (data ?? []) as LedgerRow[];
}

/**
 * Predict the carbon-tax exposure for the shipowner in the next 30 days.
 *
 * Algorithm:
 *   - Look at arrival_alerts for the shipowner over the last 90 days
 *   - If < 5 alerts → confidence='low', return zero estimates
 *   - Median tax_amount_usd × (alerts/day × 30) = projection
 *   - Confidence: low (< 5), medium (5-14), high (15+)
 *
 * NOTE: queries `transactions` (not `arrival_alerts`) because
 * `arrival_alerts` has neither `shipowner_id` nor `tax_amount_usd` —
 * those live on `transactions` (mig 026 added shipowner_id; mig 003
 * created tax_amount_usd). We filter `document_type` to actual tax
 * documents (PROFORMA / FINAL / COMPLEMENT — excludes REFUND).
 */
export async function predictNextTax(
    client: SupabaseClient,
    shipownerId: string,
): Promise<NextTaxPrediction> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data, error } = await client
        .from('transactions')
        .select('tax_amount_usd, created_at')
        .eq('shipowner_id', shipownerId)
        .in('document_type', ['PROFORMA', 'FINAL', 'COMPLEMENT'])
        .gte('created_at', ninetyDaysAgo)
        .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{ tax_amount_usd: number | null; created_at: string }>;
    const amounts = rows.map((r) => r.tax_amount_usd).filter((x): x is number => typeof x === 'number' && x > 0);

    if (amounts.length < 5) {
        return { estimated_count_30d: 0, estimated_amount_30d_usd: 0, confidence: 'low' };
    }

    // Median tax amount
    const sorted = [...amounts].sort((a, b) => a - b);
    const medianTax = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

    // Frequency: alerts/day over the actual window (first → last alert)
    const firstAt = new Date(rows[0].created_at).getTime();
    const lastAt = new Date(rows[rows.length - 1].created_at).getTime();
    // Floor at 7 days (not 1) to bound the cluster-burst case: if 30 alerts arrive
    // within 12 hours, a 1-day floor would project 900 events for the next 30 days.
    // 1-week minimum keeps the projection aggressive-but-bounded for bursty traffic.
    const windowDays = Math.max(7, (lastAt - firstAt) / 86400000);
    const alertsPerDay = rows.length / windowDays;
    const estimatedCount30d = Math.round(alertsPerDay * 30);

    const confidence: 'low' | 'medium' | 'high' =
        amounts.length < 5 ? 'low' :
        amounts.length < 15 ? 'medium' :
        'high';

    return {
        estimated_count_30d: estimatedCount30d,
        estimated_amount_30d_usd: Math.round(medianTax * estimatedCount30d),
        confidence,
    };
}
