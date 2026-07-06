import { describe, it, expect } from 'vitest';
import { settlementExportHref, recentMonthBuckets } from './SettlementExportCard';

describe('settlementExportHref', () => {
    it('returns the bare endpoint when no month is selected', () => {
        expect(settlementExportHref(null)).toBe('/api/admin/reports/settlement');
    });
    it('encodes from=to=month for a single-month export', () => {
        expect(settlementExportHref('2026-06-01')).toBe(
            '/api/admin/reports/settlement?from=2026-06-01&to=2026-06-01',
        );
    });
});

describe('recentMonthBuckets', () => {
    it('returns the previous N months, most recent first', () => {
        const buckets = recentMonthBuckets(new Date('2026-07-06T00:00:00Z'), 3);
        expect(buckets).toEqual(['2026-06-01', '2026-05-01', '2026-04-01']);
    });
    it('rolls across the year boundary', () => {
        const buckets = recentMonthBuckets(new Date('2026-02-10T00:00:00Z'), 3);
        expect(buckets).toEqual(['2026-01-01', '2025-12-01', '2025-11-01']);
    });
    it('defaults to 12 months', () => {
        expect(recentMonthBuckets(new Date('2026-07-06T00:00:00Z'))).toHaveLength(12);
    });
});
