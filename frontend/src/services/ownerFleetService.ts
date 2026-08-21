import { type SupabaseClient } from '@supabase/supabase-js';

export interface FleetVessel {
    id: string;
    name: string;
    imoNumber: string | null;
    mmsi: string | null;
    flagCode: string;
    complianceStatus: string;
    /** Factures VIVANTES visant ce navire — les annulées ne comptent pas. */
    invoiceCount: number;
    outstandingUsd: number;
    /** Faux dès qu'une facture vivante vise le navire : le geste devient « contester ». */
    canRemove: boolean;
}

/** Statuts qui laissent une somme à devoir. */
const OUTSTANDING = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];

/**
 * Flotte de l'armateur de la session, avec ce qu'il faut pour décider des
 * gestes offerts à l'écran.
 *
 * Les transactions sont filtrées sur `status <> 'VOID'`. Depuis la rebascule
 * du livre (mig 128), une référence peut être portée par deux lignes : celle
 * annulée du seed et celle réellement due. Compter l'annulée bloquerait à vie
 * le retrait d'un navire qui ne doit plus rien.
 *
 * `invoiceCount` compte les factures vivantes — payées comprises, car une
 * facture payée ancre elle aussi le navire au dossier. `outstandingUsd` ne
 * somme que ce qui reste dû.
 */
export async function listOwnerFleet(
    supabase: SupabaseClient,
    shipownerId: string,
): Promise<FleetVessel[]> {
    const { data: vessels, error: vErr } = await supabase
        .from('vessels')
        .select('id, name, imo_number, mmsi, flag_code, compliance_status')
        .eq('shipowner_id', shipownerId)
        .order('name');
    if (vErr) throw new Error(`flotte : ${vErr.message}`);

    const rows = (vessels ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return [];

    const { data: txns, error: tErr } = await supabase
        .from('transactions')
        .select('vessel_id, tax_amount_usd, status')
        .in('vessel_id', rows.map((v) => String(v.id)))
        .neq('status', 'VOID');
    if (tErr) throw new Error(`factures de la flotte : ${tErr.message}`);

    const byVessel = new Map<string, { count: number; usd: number }>();
    for (const t of (txns ?? []) as Record<string, unknown>[]) {
        const key = String(t.vessel_id);
        const acc = byVessel.get(key) ?? { count: 0, usd: 0 };
        acc.count += 1;
        if (OUTSTANDING.includes(String(t.status))) acc.usd += Number(t.tax_amount_usd ?? 0);
        byVessel.set(key, acc);
    }

    return rows.map((v) => {
        const acc = byVessel.get(String(v.id)) ?? { count: 0, usd: 0 };
        return {
            id: String(v.id),
            name: String(v.name),
            imoNumber: v.imo_number ? String(v.imo_number) : null,
            mmsi: v.mmsi ? String(v.mmsi) : null,
            flagCode: String(v.flag_code ?? 'ZZ').trim(),
            complianceStatus: String(v.compliance_status),
            invoiceCount: acc.count,
            outstandingUsd: acc.usd,
            canRemove: acc.count === 0,
        };
    });
}
