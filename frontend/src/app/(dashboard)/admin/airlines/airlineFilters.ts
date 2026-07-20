import type { AirlineCockpitRow } from '@/services/airlineService';

export interface AirlineFilterState {
    status: string;
    sanctions: string; // '' | 'OFAC' | 'UN' | 'clean'
    country: string;
    search: string;
    dueOnly: boolean;
}

export function filterAirlines(rows: AirlineCockpitRow[], state: AirlineFilterState): AirlineCockpitRow[] {
    const q = state.search.trim().toLowerCase();
    return rows.filter((r) => {
        if (state.status && r.account_state !== state.status) return false;
        if (state.sanctions === 'OFAC' && !r.is_ofac_sdn) return false;
        if (state.sanctions === 'UN' && !r.is_un_prohibited) return false;
        if (state.sanctions === 'clean' && r.sanctioned) return false;
        if (state.country && r.country_code !== state.country) return false;
        if (state.dueOnly && r.total_outstanding_usd <= 0) return false;
        if (q) {
            const hay = `${r.name} ${r.iata_code ?? ''} ${r.icao_code ?? ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}
