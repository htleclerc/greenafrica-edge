import type { ArmateurCockpitRow } from '@/services/armateurService';

export type SanctionFilter = 'all' | 'ofac' | 'un' | 'clean';
export interface ArmateurFilterState {
    search: string;
    accountState: string | 'all';
    sanction: SanctionFilter;
    country: string | 'all';
    outstandingOnly: boolean;
}

export function filterArmateurs(rows: ArmateurCockpitRow[], f: ArmateurFilterState): ArmateurCockpitRow[] {
    const q = f.search.trim().toLowerCase();
    return rows.filter((r) => {
        if (f.accountState !== 'all' && r.account_state !== f.accountState) return false;
        if (f.country !== 'all' && (r.country_code ?? '') !== f.country) return false;
        if (f.outstandingOnly && r.total_outstanding_usd <= 0) return false;
        if (f.sanction === 'ofac' && !r.is_ofac_sdn) return false;
        if (f.sanction === 'un' && !r.is_un_prohibited) return false;
        if (f.sanction === 'clean' && r.sanctioned) return false;
        if (q) {
            const hay = `${r.name} ${r.imo_company_no ?? ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}
