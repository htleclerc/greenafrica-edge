import { describe, it, expect } from 'vitest';
import { filterArmateurs, type ArmateurFilterState } from './armateurFilters';
import type { ArmateurCockpitRow } from '@/services/armateurService';

const base: ArmateurCockpitRow = {
    id: 'x', name: 'ANJIL BULKERS SA', country_code: 'PA', account_state: 'GHOST',
    is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false,
    official_email: null, imo_company_no: '9999999', proforma_count: 1,
    total_invoiced_usd: 100, total_paid_usd: 0, total_outstanding_usd: 100,
    overdue_count: 0, next_due_date: null, last_auto_tier: null,
    last_reminder_at: null, latest_response_type: null, open_count: 0,
};
const rows: ArmateurCockpitRow[] = [
    base,
    { ...base, id: 'ofac', name: 'IRISL', is_ofac_sdn: true, sanctioned: true, country_code: 'IR', total_outstanding_usd: 0 },
    { ...base, id: 'paid', name: 'PAID CO', total_outstanding_usd: 0 },
];
const all: ArmateurFilterState = { search: '', accountState: 'all', sanction: 'all', country: 'all', outstandingOnly: false };

describe('filterArmateurs', () => {
    it('sanction=ofac ne garde que les OFAC', () => {
        expect(filterArmateurs(rows, { ...all, sanction: 'ofac' }).map((r) => r.id)).toEqual(['ofac']);
    });
    it('outstandingOnly retire les dûs à 0', () => {
        expect(filterArmateurs(rows, { ...all, outstandingOnly: true }).map((r) => r.id)).toEqual(['x']);
    });
    it('search filtre par nom ou imo_company_no (insensible casse)', () => {
        expect(filterArmateurs(rows, { ...all, search: 'irisl' }).map((r) => r.id)).toEqual(['ofac']);
        expect(filterArmateurs(rows, { ...all, search: '9999999' }).length).toBe(3);
    });
    it('country filtre par pays', () => {
        expect(filterArmateurs(rows, { ...all, country: 'IR' }).map((r) => r.id)).toEqual(['ofac']);
    });
});
