import { describe, it, expect } from 'vitest';
import { getReglementsSummary } from './reglementsService';

function makeDb(rows: Record<string, unknown>[]) {
    const builder: Record<string, unknown> = {};
    builder.select = () => Promise.resolve({ data: rows, error: null });
    return { from: () => builder } as never;
}

describe('getReglementsSummary', () => {
    it('normalise les chaînes PostgREST en nombres', async () => {
        const s = await getReglementsSummary(makeDb([{
            jurisdiction_id: 'j1',
            invoiced_today_usd: '42100.50', invoiced_today_count: '3',
            invoiced_week_usd: '0', invoiced_week_count: '0',
            invoiced_month_usd: '0', invoiced_month_count: '0',
            collected_today_usd: '18500', collected_today_count: '2',
            collected_week_usd: '0', collected_week_count: '0',
            collected_month_usd: '0', collected_month_count: '0',
            total_outstanding_usd: '1630200', overdue_usd: '947300', overdue_count: '88',
        }]));
        expect(s.invoicedToday).toEqual({ usd: 42100.5, count: 3 });
        expect(s.collectedToday).toEqual({ usd: 18500, count: 2 });
        expect(s.overdueCount).toBe(88);
    });

    it('additionne les juridictions visibles', async () => {
        // Un SUPERADMIN voit plusieurs juridictions : le tableau de bord
        // présente un total consolidé, pas la première ligne venue.
        const row = (id: string, usd: string) => ({
            jurisdiction_id: id,
            invoiced_today_usd: usd, invoiced_today_count: '1',
            invoiced_week_usd: '0', invoiced_week_count: '0',
            invoiced_month_usd: '0', invoiced_month_count: '0',
            collected_today_usd: '0', collected_today_count: '0',
            collected_week_usd: '0', collected_week_count: '0',
            collected_month_usd: '0', collected_month_count: '0',
            total_outstanding_usd: '0', overdue_usd: '0', overdue_count: '0',
        });
        const s = await getReglementsSummary(makeDb([row('j1', '100'), row('j2', '250')]));
        expect(s.invoicedToday).toEqual({ usd: 350, count: 2 });
    });

    it('renvoie des zéros quand la vue ne rend aucune ligne', async () => {
        const s = await getReglementsSummary(makeDb([]));
        expect(s.invoicedToday).toEqual({ usd: 0, count: 0 });
        expect(s.totalOutstandingUsd).toBe(0);
    });
});
