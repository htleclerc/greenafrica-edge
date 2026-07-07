import { describe, it, expect, vi } from 'vitest';
import {
    buildSettlementCsv,
    fetchSettlement,
    formatMonth,
    previousMonthBucket,
    settlementFilename,
    type SettlementRow,
} from './settlementReportService';

function row(overrides: Partial<SettlementRow> = {}): SettlementRow {
    return {
        jurisdiction_id: 'j1',
        jurisdiction_code: 'SO',
        month: '2026-05-01',
        mode: 'MARITIME',
        tx_count: 3,
        total_usd: 1000,
        concessionaire_usd: 300,
        sovereign_usd: 700,
        unattributed_count: 0,
        unattributed_usd: 0,
        mismatched_count: 0,
        mismatched_usd: 0,
        ...overrides,
    };
}

describe('buildSettlementCsv', () => {
    it('emits a header row followed by one data row per settlement row (CRLF)', () => {
        const csv = buildSettlementCsv([row()]);
        const lines = csv.split('\r\n');
        expect(lines[0]).toBe(
            'jurisdiction_code,month,mode,tx_count,total_usd,concessionaire_usd,sovereign_usd,unattributed_count,unattributed_usd,mismatched_count,mismatched_usd',
        );
        expect(lines[1]).toBe('SO,2026-05,MARITIME,3,1000.00,300.00,700.00,0,0.00,0,0.00');
        expect(lines).toHaveLength(2);
    });

    it('renders the month bucket as YYYY-MM', () => {
        const csv = buildSettlementCsv([row({ month: '2026-11-01' })]);
        expect(csv.split('\r\n')[1]).toContain('2026-11');
    });

    it('treats NULL money/count fields as 0', () => {
        const csv = buildSettlementCsv([
            row({ concessionaire_usd: null, sovereign_usd: null, unattributed_usd: null, mismatched_usd: null, total_usd: null }),
        ]);
        expect(csv.split('\r\n')[1]).toBe('SO,2026-05,MARITIME,3,0.00,0.00,0.00,0,0.00,0,0.00');
    });

    it('formats money to exactly 2 decimals', () => {
        const csv = buildSettlementCsv([row({ total_usd: 1234.5, concessionaire_usd: 370.355 })]);
        const cells = csv.split('\r\n')[1].split(',');
        expect(cells[4]).toBe('1234.50');
        expect(cells[5]).toBe('370.36');
    });

    it('escapes fields that contain a comma or quote (RFC-4180)', () => {
        const csv = buildSettlementCsv([row({ jurisdiction_code: 'A,B', mode: 'x"y' })]);
        const line = csv.split('\r\n')[1];
        expect(line).toContain('"A,B"');
        expect(line).toContain('"x""y"');
    });

    it('returns just the header for an empty result set', () => {
        const csv = buildSettlementCsv([]);
        expect(csv.split('\r\n')).toHaveLength(1);
    });
});

describe('formatMonth', () => {
    it('slices an ISO date down to YYYY-MM', () => {
        expect(formatMonth('2026-05-01')).toBe('2026-05');
    });
});

describe('previousMonthBucket', () => {
    it('returns the first day of the previous month in UTC', () => {
        expect(previousMonthBucket(new Date('2026-07-06T09:00:00Z'))).toBe('2026-06-01');
    });
    it('rolls over the year boundary', () => {
        expect(previousMonthBucket(new Date('2026-01-15T00:00:00Z'))).toBe('2025-12-01');
    });
});

describe('settlementFilename', () => {
    it('includes jurisdiction and period when present', () => {
        expect(settlementFilename({ jurisdictionCode: 'SO', from: '2026-06-01' })).toBe(
            'greengate-settlement-SO-2026-06.csv',
        );
    });
    it('falls back to a bare name with no filters', () => {
        expect(settlementFilename({})).toBe('greengate-settlement.csv');
    });
});

describe('fetchSettlement', () => {
    function mockClient(result: { data?: unknown; error?: unknown }) {
        const builder: Record<string, ReturnType<typeof vi.fn>> = {};
        for (const m of ['select', 'order', 'gte', 'lte', 'eq']) {
            builder[m] = vi.fn(() => builder);
        }
        // Resolve the awaited query at the end of the chain.
        builder.then = vi.fn((resolve: (v: unknown) => void) => resolve(result));
        const from = vi.fn(() => builder);
        return { client: { from } as never, builder, from };
    }

    it('queries the settlement view and returns rows', async () => {
        const { client, from } = mockClient({ data: [row()], error: null });
        const rows = await fetchSettlement(client, {});
        expect(from).toHaveBeenCalledWith('v_revenue_split_settlement');
        expect(rows).toHaveLength(1);
    });

    it('applies from/to/jurisdiction/mode filters', async () => {
        const { client, builder } = mockClient({ data: [], error: null });
        await fetchSettlement(client, { from: '2026-06-01', to: '2026-06-01', jurisdictionCode: 'SO', mode: 'MARITIME' });
        expect(builder.gte).toHaveBeenCalledWith('month', '2026-06-01');
        expect(builder.lte).toHaveBeenCalledWith('month', '2026-06-01');
        expect(builder.eq).toHaveBeenCalledWith('jurisdiction_code', 'SO');
        expect(builder.eq).toHaveBeenCalledWith('mode', 'MARITIME');
    });

    it('throws on a query error', async () => {
        const { client } = mockClient({ data: null, error: { message: 'boom' } });
        await expect(fetchSettlement(client, {})).rejects.toThrow('boom');
    });
});
