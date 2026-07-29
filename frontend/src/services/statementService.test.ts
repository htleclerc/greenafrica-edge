import { describe, it, expect } from 'vitest';
import { composeOwnerStatement, statementStoragePath, periodBounds } from './statementService';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('periodBounds', () => {
    it('renvoie [1er du mois précédent, 1er du mois courant)', () => {
        const { periodStart, periodEnd, label } = periodBounds(new Date('2026-07-03T06:00:00Z'));
        expect(periodStart.toISOString().slice(0, 10)).toBe('2026-06-01');
        expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-07-01');
        expect(label).toBe('June 2026');
    });
    it('gère le passage d\'année (janvier → décembre précédent)', () => {
        const { periodStart, label } = periodBounds(new Date('2026-01-10T06:00:00Z'));
        expect(periodStart.toISOString().slice(0, 10)).toBe('2025-12-01');
        expect(label).toBe('December 2025');
    });
});

describe('statementStoragePath', () => {
    it('range sous statements/<owner>/<YYYY-MM>.pdf', () => {
        expect(statementStoragePath('own-1', new Date('2026-06-01T00:00:00Z')))
            .toBe('statements/own-1/2026-06.pdf');
    });
});

describe('composeOwnerStatement', () => {
    // Faux client : transactions (ouvertes) + payments (mois).
    function makeDb(txns: Record<string, unknown>[], pays: Record<string, unknown>[]) {
        const from = (table: string) => {
            if (table === 'transactions') {
                return { select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: txns, error: null }) }) }) }) };
            }
            if (table === 'payments') {
                return { select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ lt: async () => ({ data: pays, error: null }) }) }) }) }) };
            }
            throw new Error(`unexpected ${table}`);
        };
        return { from } as unknown as SupabaseClient;
    }

    it('compose lignes ouvertes, paiements du mois, totaux', async () => {
        const db = makeDb(
            [
                { invoice_ref: 'PRO-1', vessel_name: 'MV A', created_at: '2026-06-10T00:00:00Z', tax_amount_usd: '16500', partial_paid_usd: '0' },
                { invoice_ref: 'PRO-2', vessel_name: 'MV B', created_at: '2026-06-14T00:00:00Z', tax_amount_usd: '12000', partial_paid_usd: '500' },
                { invoice_ref: 'PRO-3', vessel_name: 'MV C', created_at: '2026-06-16T00:00:00Z', tax_amount_usd: '9000', partial_paid_usd: '4000' },
            ],
            [
                { confirmed_at: '2026-06-20T00:00:00Z', receipt_ref: 'RCT-1', amount_usd_minor: '500000' },
            ],
        );
        const res = await composeOwnerStatement(db, {
            shipownerId: 'own-1',
            periodStart: new Date('2026-06-01T00:00:00Z'),
            periodEnd: new Date('2026-07-01T00:00:00Z'),
            now: new Date('2026-07-01T00:00:00Z'),
        });
        expect(res.openCount).toBe(3);
        expect(res.openLines[0]).toMatchObject({ invoiceRef: 'PRO-1', outstandingUsd: 16500 });
        expect(res.openLines[1].outstandingUsd).toBe(11500); // 12000 - 500
        expect(res.openLines[2]).toMatchObject({ invoiceRef: 'PRO-3', outstandingUsd: 5000 }); // 9000 - 4000 (PARTIALLY_PAID)
        expect(res.totalOutstandingUsd).toBe(33000);
        expect(res.paymentsInMonthUsd).toBe(5000); // 500000 minor / 100
        expect(res.payments[0]).toMatchObject({ receiptRef: 'RCT-1', amountUsd: 5000 });
    });
});
