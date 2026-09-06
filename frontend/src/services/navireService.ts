import type { SupabaseClient } from '@supabase/supabase-js';

// La vue n'est pas dans supabase.generated.ts (même patron que collectionAdminService).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export interface NavireRecouvrementRow {
    id: string;
    name: string;
    imo_number: string | null;
    flag_code: string | null;
    category: string | null;
    gross_tonnage_dwt: number;
    compliance_status: string | null;
    shipowner_id: string | null;
    shipowner_name: string | null;
    /** Reference opaque de l'armateur, pour construire le lien sans UUID. */
    shipowner_public_ref: string | null;
    /** Référence opaque du navire (mig 147/150), pour « voir comme ce navire ». */
    vessel_public_ref: string | null;
    shipowner_sanctioned: boolean;
    proforma_count: number;
    total_invoiced_usd: number;
    total_paid_usd: number;
    total_outstanding_usd: number;
    open_count: number;
    overdue_count: number;
    next_due_date: string | null;
    last_invoiced_at: string | null;
}

/**
 * État de recouvrement d'un navire.
 *
 * `SETTLED` et `NEVER_INVOICED` affichent tous deux zéro dû : les distinguer
 * évite de prendre un navire jamais passé par la facturation pour un navire
 * à jour de ses paiements.
 */
export type NavireCollectionsState = 'OVERDUE' | 'OPEN' | 'SETTLED' | 'NEVER_INVOICED';

export function navireCollectionsState(row: {
    open_count: number;
    overdue_count: number;
    proforma_count?: number;
}): NavireCollectionsState {
    if (row.overdue_count > 0) return 'OVERDUE';
    if (row.open_count > 0) return 'OPEN';
    return (row.proforma_count ?? 0) > 0 ? 'SETTLED' : 'NEVER_INVOICED';
}

/**
 * Encours par navire, trié du plus endetté au moins endetté.
 *
 * L'encours vient de `v_navire_recouvrement`, elle-même bâtie sur
 * `v_transaction_outstanding` (mig 132) : il n'est jamais recalculé depuis
 * `transactions.partial_paid_usd`, colonne gelée qui vaut zéro sur toute
 * facture en cours.
 *
 * Une créance sans navire rattaché est absente de cette vue — comparer la
 * somme des encours au total du tableau de bord révèle l'écart.
 */
export async function listNaviresRecouvrement(db: Client): Promise<NavireRecouvrementRow[]> {
    const { data, error } = await db
        .from('v_navire_recouvrement')
        .select('*')
        .order('total_outstanding_usd', { ascending: false });
    if (error) throw new Error(`listNaviresRecouvrement: ${error.message}`);

    // PostgREST rend les NUMERIC et BIGINT en chaînes → normaliser en nombres.
    return (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        name: String(r.name ?? ''),
        imo_number: (r.imo_number as string | null) ?? null,
        flag_code: (r.flag_code as string | null) ?? null,
        category: (r.category as string | null) ?? null,
        gross_tonnage_dwt: Number(r.gross_tonnage_dwt ?? 0),
        compliance_status: (r.compliance_status as string | null) ?? null,
        shipowner_id: (r.shipowner_id as string | null) ?? null,
        shipowner_name: (r.shipowner_name as string | null) ?? null,
        shipowner_public_ref: (r.shipowner_public_ref as string | null) ?? null,
        vessel_public_ref: (r.vessel_public_ref as string | null) ?? null,
        shipowner_sanctioned: r.shipowner_sanctioned === true,
        proforma_count: Number(r.proforma_count ?? 0),
        total_invoiced_usd: Number(r.total_invoiced_usd ?? 0),
        total_paid_usd: Number(r.total_paid_usd ?? 0),
        total_outstanding_usd: Number(r.total_outstanding_usd ?? 0),
        open_count: Number(r.open_count ?? 0),
        overdue_count: Number(r.overdue_count ?? 0),
        next_due_date: (r.next_due_date as string | null) ?? null,
        last_invoiced_at: (r.last_invoiced_at as string | null) ?? null,
    }));
}
