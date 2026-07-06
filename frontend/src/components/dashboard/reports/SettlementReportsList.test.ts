import { describe, it, expect } from 'vitest';
import { groupSettlementByMonth } from './SettlementReportsList';
import type { SettlementRow } from '@/services/settlementReportService';

function row(over: Partial<SettlementRow> = {}): SettlementRow {
    return {
        jurisdiction_id: 'j1', jurisdiction_code: 'SO', month: '2026-05-01', mode: 'MARITIME',
        tx_count: 1, total_usd: 100, concessionaire_usd: 30, sovereign_usd: 70,
        unattributed_count: 0, unattributed_usd: 0, mismatched_count: 0, mismatched_usd: 0, ...over,
    };
}

describe('groupSettlementByMonth', () => {
    it('sums rows sharing a month across jurisdictions and modes', () => {
        const out = groupSettlementByMonth([
            row({ month: '2026-05-01', mode: 'MARITIME', tx_count: 2, total_usd: 200, concessionaire_usd: 60, sovereign_usd: 140 }),
            row({ month: '2026-05-01', mode: 'AVIATION', jurisdiction_code: 'DJ', tx_count: 1, total_usd: 50, concessionaire_usd: 15, sovereign_usd: 35 }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({ month: '2026-05-01', txCount: 3, totalUsd: 250, concessionaireUsd: 75, sovereignUsd: 175 });
    });

    it('returns one entry per month, most recent first', () => {
        const out = groupSettlementByMonth([
            row({ month: '2026-04-01' }),
            row({ month: '2026-06-01' }),
            row({ month: '2026-05-01' }),
        ]);
        expect(out.map((m) => m.month)).toEqual(['2026-06-01', '2026-05-01', '2026-04-01']);
    });

    it('treats NULL split amounts as 0', () => {
        const out = groupSettlementByMonth([
            row({ concessionaire_usd: null, sovereign_usd: null, total_usd: null, tx_count: 2 }),
        ]);
        expect(out[0]).toEqual({ month: '2026-05-01', txCount: 2, totalUsd: 0, concessionaireUsd: 0, sovereignUsd: 0 });
    });

    it('returns an empty array for no rows', () => {
        expect(groupSettlementByMonth([])).toEqual([]);
    });
});
