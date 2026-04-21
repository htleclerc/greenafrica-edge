import { describe, it, expect } from 'vitest';
import { getArmateurKpis } from '../kpiService';

// RLS does the owner-scoping at DB level — these mocks simulate what the
// SSR-scoped client would return FOR THIS armateur (pre-filtered rows).
function mockClient(transactions: unknown[], vessels: unknown[]) {
    return {
        from(table: string) {
            return {
                select() {
                    if (table === 'transactions') return Promise.resolve({ data: transactions });
                    if (table === 'vessels') return Promise.resolve({ data: vessels });
                    return Promise.resolve({ data: [] });
                },
            };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

const now = new Date();
const thisYear = now.getFullYear();
const today = now.toISOString();
const fortyDaysAgo = new Date(now.getTime() - 40 * 86400000).toISOString();
const tenDaysAgo = new Date(now.getTime() - 10 * 86400000).toISOString();
const lastYear = new Date(thisYear - 1, 5, 15).toISOString();

describe('getArmateurKpis', () => {
    it('returns all zeros for empty fleet + no transactions', async () => {
        const client = mockClient([], []);
        const kpis = await getArmateurKpis(client);
        expect(kpis).toEqual({
            outstandingTotalUsd: 0,
            vesselsActive: 0,
            taxPaidYtdUsd: 0,
            overdueCount: 0,
        });
    });

    it('sums outstandingTotalUsd from PENDING tx only', async () => {
        const client = mockClient(
            [
                { tax_amount_usd: 1200, created_at: today, status: 'PENDING' },
                { tax_amount_usd: 800, created_at: today, status: 'PENDING' },
                { tax_amount_usd: 500, created_at: today, status: 'PAID' },      // excluded
                { tax_amount_usd: 300, created_at: today, status: 'EXEMPT' },    // excluded
            ],
            [],
        );
        const kpis = await getArmateurKpis(client);
        expect(kpis.outstandingTotalUsd).toBe(2000);
    });

    it('counts only non-EXEMPT vessels in vesselsActive', async () => {
        const client = mockClient([], [
            { compliance_status: 'COMPLIANT' },
            { compliance_status: 'PAYMENT_DUE' },
            { compliance_status: 'NON_COMPLIANT' },
            { compliance_status: 'EXEMPT' },       // excluded
            { compliance_status: 'PROCESSING' },
        ]);
        const kpis = await getArmateurKpis(client);
        expect(kpis.vesselsActive).toBe(4);
    });

    it('taxPaidYtdUsd sums only PAID + current-year tx', async () => {
        const client = mockClient(
            [
                { tax_amount_usd: 1000, created_at: today, status: 'PAID' },
                { tax_amount_usd: 500, created_at: tenDaysAgo, status: 'PAID' },
                { tax_amount_usd: 999, created_at: lastYear, status: 'PAID' },    // excluded (prior year)
                { tax_amount_usd: 2000, created_at: today, status: 'PENDING' },   // excluded (not paid)
            ],
            [],
        );
        const kpis = await getArmateurKpis(client);
        expect(kpis.taxPaidYtdUsd).toBe(1500);
    });

    it('overdueCount counts PENDING tx older than 30 days', async () => {
        const client = mockClient(
            [
                { tax_amount_usd: 100, created_at: fortyDaysAgo, status: 'PENDING' },  // overdue
                { tax_amount_usd: 100, created_at: fortyDaysAgo, status: 'PENDING' },  // overdue
                { tax_amount_usd: 100, created_at: tenDaysAgo, status: 'PENDING' },    // not yet overdue
                { tax_amount_usd: 100, created_at: fortyDaysAgo, status: 'PAID' },     // excluded (paid)
            ],
            [],
        );
        const kpis = await getArmateurKpis(client);
        expect(kpis.overdueCount).toBe(2);
    });

    it('full realistic portfolio → computes all 4 fields correctly', async () => {
        const client = mockClient(
            [
                // Paid this year: $1500 total
                { tax_amount_usd: 1000, created_at: today, status: 'PAID' },
                { tax_amount_usd: 500, created_at: tenDaysAgo, status: 'PAID' },
                // Pending (outstanding): $2200 total, 1 overdue
                { tax_amount_usd: 1200, created_at: tenDaysAgo, status: 'PENDING' },
                { tax_amount_usd: 1000, created_at: fortyDaysAgo, status: 'PENDING' },  // overdue
            ],
            [
                { compliance_status: 'COMPLIANT' },
                { compliance_status: 'PAYMENT_DUE' },
                { compliance_status: 'EXEMPT' },  // excluded
            ],
        );
        const kpis = await getArmateurKpis(client);
        expect(kpis).toEqual({
            outstandingTotalUsd: 2200,
            vesselsActive: 2,
            taxPaidYtdUsd: 1500,
            overdueCount: 1,
        });
    });
});
