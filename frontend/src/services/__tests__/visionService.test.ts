import { describe, it, expect } from 'vitest';
import { getVisionCounters } from '../visionService';

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────────────────────────

type QueryCapture = {
    table: string;
    filters: Record<string, unknown>;
    inFilters: Record<string, unknown[]>;
    gteFilters: Record<string, string>;
    isCount: boolean;
    limitVal?: number;
    selectStr?: string;
};

/**
 * Builds a fluent Supabase-like mock that:
 *   - records all filter calls for assertion
 *   - resolves to the rows/count provided per table
 */
function mockClient(
    tableData: Record<string, { rows?: unknown[]; count?: number }>,
) {
    return {
        from(table: string) {
            const capture: QueryCapture = {
                table,
                filters: {},
                inFilters: {},
                gteFilters: {},
                isCount: false,
            };
            const data = tableData[table] ?? { rows: [], count: 0 };

            const builder: Record<string, unknown> = {
                select(str: string, opts?: { count: string; head: boolean }) {
                    capture.selectStr = str;
                    capture.isCount = !!opts?.head;
                    return builder;
                },
                eq(col: string, val: unknown) {
                    capture.filters[col] = val;
                    return builder;
                },
                in(col: string, vals: unknown[]) {
                    capture.inFilters[col] = vals;
                    return builder;
                },
                gte(col: string, val: string) {
                    capture.gteFilters[col] = val;
                    return builder;
                },
                order() {
                    return builder;
                },
                limit(n: number) {
                    capture.limitVal = n;
                    return builder;
                },
                then(resolve: (v: unknown) => void) {
                    if (capture.isCount) {
                        resolve({ data: null, count: data.count ?? 0, error: null });
                    } else {
                        resolve({ data: data.rows ?? [], error: null });
                    }
                },
            };

            // Make the builder thenable (returns a Promise via implicit .then)
            return {
                ...builder,
                // capture ref for assertions when needed
                _capture: capture,
            };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test data
// ─────────────────────────────────────────────────────────────────────────────

const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

const sampleAlertRows = [
    { id: 'a1', ref: 'SL-001', mode: 'MARITIME', departed_eez_at: sixDaysAgo },
    { id: 'a2', ref: 'SL-002', mode: 'AIR',       departed_eez_at: sixDaysAgo },
];

const samplePaidRows = [
    { tax_amount_usd: 1200 },
    { tax_amount_usd: 800 },
];

const sampleUnpaidRows = [
    { tax_amount_usd: 500 },
    { tax_amount_usd: 700 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('getVisionCounters', () => {
    it('returns all zeros for empty tables', async () => {
        const db = mockClient({
            arrival_alerts: { rows: [], count: 0 },
            transactions:   { rows: [], count: 0 },
        });

        const result = await getVisionCounters(db, { mode: null });

        expect(result).toEqual({
            atPort: 0,
            approaching: 0,
            recentDepartures: [],
            paidLast7dCount: 0,
            paidLast7dUsd: 0,
            unpaidInProgressCount: 0,
            unpaidInProgressUsd: 0,
        });
    });

    it('counts atPort (ARRIVED) and approaching separately', async () => {
        const db = mockClient({
            arrival_alerts: { rows: sampleAlertRows, count: 3 },
            transactions:   { rows: [] },
        });

        // Both atPort and approaching queries hit arrival_alerts — count is mocked at 3
        const result = await getVisionCounters(db, { mode: null });

        expect(result.atPort).toBe(3);
        expect(result.approaching).toBe(3);
    });

    it('maps recentDepartures fields correctly', async () => {
        const db = mockClient({
            arrival_alerts: { rows: sampleAlertRows, count: 0 },
            transactions:   { rows: [] },
        });

        const result = await getVisionCounters(db, { mode: null });

        expect(result.recentDepartures).toHaveLength(2);
        expect(result.recentDepartures[0]).toMatchObject({
            id: 'a1',
            ref: 'SL-001',
            mode: 'MARITIME',
            departedAt: sixDaysAgo,
        });
        expect(result.recentDepartures[1]).toMatchObject({
            id: 'a2',
            ref: 'SL-002',
            mode: 'AIR',
        });
    });

    it('sums paidLast7dUsd from tax_amount_usd directly (no cents conversion)', async () => {
        const db = mockClient({
            arrival_alerts: { rows: [], count: 0 },
            transactions:   { rows: samplePaidRows },
        });

        const result = await getVisionCounters(db, { mode: null });

        expect(result.paidLast7dCount).toBe(2);
        expect(result.paidLast7dUsd).toBe(2000);
    });

    it('sums unpaidInProgressUsd from PENDING PROFORMA/FINAL rows', async () => {
        const db = mockClient({
            arrival_alerts: { rows: [], count: 0 },
            transactions:   { rows: sampleUnpaidRows },
        });

        const result = await getVisionCounters(db, { mode: null });

        expect(result.unpaidInProgressCount).toBe(2);
        expect(result.unpaidInProgressUsd).toBe(1200);
    });

    it('applies no mode filter when mode is null', async () => {
        // We track whether eq('mode', ...) is ever called by inspecting
        // the mock via a custom spy approach.
        const eqCalls: Array<[string, unknown]> = [];

        const spyDb = {
            from(_table: string) {
                const b = {
                    select() { return b; },
                    eq(col: string, val: unknown) {
                        eqCalls.push([col, val]);
                        return b;
                    },
                    in() { return b; },
                    gte() { return b; },
                    order() { return b; },
                    limit() { return b; },
                    then(resolve: (v: unknown) => void) {
                        resolve({ data: [], count: 0, error: null });
                    },
                };
                return b;
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await getVisionCounters(spyDb, { mode: null });

        const modeEqCalls = eqCalls.filter(([col]) => col === 'mode');
        expect(modeEqCalls).toHaveLength(0);
    });

    it('applies .eq("mode", "MARITIME") on every query when mode is MARITIME', async () => {
        const eqCalls: Array<[string, unknown]> = [];

        const spyDb = {
            from(_table: string) {
                const b = {
                    select() { return b; },
                    eq(col: string, val: unknown) {
                        eqCalls.push([col, val]);
                        return b;
                    },
                    in() { return b; },
                    gte() { return b; },
                    order() { return b; },
                    limit() { return b; },
                    then(resolve: (v: unknown) => void) {
                        resolve({ data: [], count: 0, error: null });
                    },
                };
                return b;
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await getVisionCounters(spyDb, { mode: 'MARITIME' });

        const modeEqCalls = eqCalls.filter(([col]) => col === 'mode');
        // 5 queries × 1 mode filter each = 5 calls
        expect(modeEqCalls).toHaveLength(5);
        expect(modeEqCalls.every(([, val]) => val === 'MARITIME')).toBe(true);
    });

    it('applies .eq("mode", "AIR") on every query when mode is AIR', async () => {
        const eqCalls: Array<[string, unknown]> = [];

        const spyDb = {
            from(_table: string) {
                const b = {
                    select() { return b; },
                    eq(col: string, val: unknown) {
                        eqCalls.push([col, val]);
                        return b;
                    },
                    in() { return b; },
                    gte() { return b; },
                    order() { return b; },
                    limit() { return b; },
                    then(resolve: (v: unknown) => void) {
                        resolve({ data: [], count: 0, error: null });
                    },
                };
                return b;
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await getVisionCounters(spyDb, { mode: 'AIR' });

        const modeEqCalls = eqCalls.filter(([col]) => col === 'mode');
        expect(modeEqCalls).toHaveLength(5);
        expect(modeEqCalls.every(([, val]) => val === 'AIR')).toBe(true);
    });

    it('paid query filters by status=PAID and gte paid_at (7d window)', async () => {
        const statusFilters: unknown[] = [];
        const gteFilters: Array<[string, string]> = [];

        const spyDb = {
            from(table: string) {
                const b = {
                    select() { return b; },
                    eq(col: string, val: unknown) {
                        if (table === 'transactions' && col === 'status') {
                            statusFilters.push(val);
                        }
                        return b;
                    },
                    in() { return b; },
                    gte(col: string, val: string) {
                        gteFilters.push([col, val]);
                        return b;
                    },
                    order() { return b; },
                    limit() { return b; },
                    then(resolve: (v: unknown) => void) {
                        resolve({ data: [], count: 0, error: null });
                    },
                };
                return b;
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await getVisionCounters(spyDb, { mode: null });

        expect(statusFilters).toContain('PAID');
        // gte on paid_at should be present
        const paidAtGte = gteFilters.find(([col]) => col === 'paid_at');
        expect(paidAtGte).toBeDefined();
    });

    it('unpaid query filters by status=PENDING and document_type IN PROFORMA/FINAL', async () => {
        const inFilters: Array<[string, unknown[]]> = [];
        const statusFilters: unknown[] = [];

        const spyDb = {
            from(table: string) {
                const b = {
                    select() { return b; },
                    eq(col: string, val: unknown) {
                        if (table === 'transactions' && col === 'status') {
                            statusFilters.push(val);
                        }
                        return b;
                    },
                    in(col: string, vals: unknown[]) {
                        inFilters.push([col, vals]);
                        return b;
                    },
                    gte() { return b; },
                    order() { return b; },
                    limit() { return b; },
                    then(resolve: (v: unknown) => void) {
                        resolve({ data: [], count: 0, error: null });
                    },
                };
                return b;
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await getVisionCounters(spyDb, { mode: null });

        expect(statusFilters).toContain('PENDING');
        const docTypeIn = inFilters.find(([col]) => col === 'document_type');
        expect(docTypeIn).toBeDefined();
        expect(docTypeIn![1]).toContain('PROFORMA');
        expect(docTypeIn![1]).toContain('FINAL');
    });

    it('handles null tax_amount_usd gracefully (treats as 0)', async () => {
        const db = mockClient({
            arrival_alerts: { rows: [], count: 0 },
            transactions:   { rows: [{ tax_amount_usd: null }, { tax_amount_usd: 500 }] },
        });

        const result = await getVisionCounters(db, { mode: null });

        expect(result.paidLast7dUsd).toBe(500);
        expect(result.unpaidInProgressUsd).toBe(500);
    });
});
