import { describe, it, expect } from 'vitest';
import { filterAirlines, type AirlineFilterState } from './airlineFilters';
import type { AirlineCockpitRow } from '@/services/airlineService';

const base: AirlineCockpitRow = {
    id: '1', name: 'Demo Airways', country_code: 'SO', account_state: 'ACTIVE',
    is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false, official_email: null,
    iata_code: 'DA', icao_code: 'DMO', hub_code: 'HGA', aoc_number: 'AOC-1',
    proforma_count: 2, total_invoiced_usd: 100, total_paid_usd: 40, total_outstanding_usd: 60,
};
const rows: AirlineCockpitRow[] = [
    base,
    { ...base, id: '2', name: 'Sanctioned Air', iata_code: 'SX', icao_code: 'SNX', is_ofac_sdn: true, sanctioned: true, total_outstanding_usd: 0 },
];
const empty: AirlineFilterState = { status: '', sanctions: '', country: '', search: '', dueOnly: false };

describe('filterAirlines', () => {
    it('sans filtre renvoie tout', () => { expect(filterAirlines(rows, empty)).toHaveLength(2); });
    it('sanctions=OFAC ne garde que les OFAC', () => {
        expect(filterAirlines(rows, { ...empty, sanctions: 'OFAC' }).map((r) => r.id)).toEqual(['2']);
    });
    it('dû>0 exclut les compagnies à jour', () => {
        expect(filterAirlines(rows, { ...empty, dueOnly: true }).map((r) => r.id)).toEqual(['1']);
    });
    it('recherche par IATA retrouve la ligne', () => {
        expect(filterAirlines(rows, { ...empty, search: 'sx' }).map((r) => r.id)).toEqual(['2']);
    });
});
