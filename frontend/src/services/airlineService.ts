import type { SupabaseClient } from '@supabase/supabase-js';

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
