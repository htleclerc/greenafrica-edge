import { describe, it, expect } from 'vitest';
import { composeOwnerStatement, statementStoragePath, periodBounds, currentMonthBounds } from './statementService';
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

describe('currentMonthBounds', () => {
    it('borne le mois EN COURS, du 1er à maintenant', () => {
        // periodBounds() vise le mois ÉCOULÉ et reste réservé au cron mensuel.
        // Un récap envoyé à la main doit refléter le mois en cours.
        const now = new Date('2026-08-20T14:30:00Z');
        const b = currentMonthBounds(now);
        expect(b.periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z');
        expect(b.periodEnd.toISOString()).toBe('2026-08-20T14:30:00.000Z');
        expect(b.label).toBe('August 2026');
    });

    it('gère le 1er du mois', () => {
        const b = currentMonthBounds(new Date('2026-09-01T00:05:00Z'));
        expect(b.periodStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });
});

describe('statementStoragePath', () => {
    it('range sous statements/<owner>/<YYYY-MM>.pdf', () => {
        expect(statementStoragePath('own-1', new Date('2026-06-01T00:00:00Z')))
            .toBe('statements/own-1/2026-06.pdf');
    });
});

describe('composeOwnerStatement', () => {
    /**
     * Faux client Postgrest. Enregistre les filtres poses, puis applique
     * reellement `eq`, `in`, `lte`, `gte`, `lt` et `not(col,'in',...)` sur les
     * jeux fournis : le service compose desormais DEUX requetes `payments`
     * (les encaissements anterieurs a l'arrete, puis ceux de la periode), que
     * seul un simulacre qui filtre vraiment sait distinguer.
     */
    function makeDb(txns: Record<string, unknown>[], pays: Record<string, unknown>[]) {
        const from = (table: string) => {
            let rows = [...(table === 'transactions' ? txns : pays)];
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.eq = (col: string, val: unknown) => {
                if (col === 'document_type' || col === 'shipowner_id' || col === 'status') {
                    rows = rows.filter((r) => r[col] === undefined || r[col] === val);
                } else {
                    rows = rows.filter((r) => r[col] === val);
                }
                return chain;
            };
            chain.in = (col: string, vals: unknown[]) => {
                rows = rows.filter((r) => vals.includes(r[col]));
                return chain;
            };
            chain.not = (col: string, op: string, list: string) => {
                const excluded = list.replace(/[()]/g, '').split(',');
                rows = rows.filter((r) => !excluded.includes(String(r[col])));
                return chain;
            };
            chain.lte = (col: string, iso: string) => {
                rows = rows.filter((r) => String(r[col]) <= iso);
                return chain;
            };
            chain.gte = (col: string, iso: string) => {
                rows = rows.filter((r) => String(r[col]) >= iso);
                return chain;
            };
            chain.lt = (col: string, iso: string) => {
                rows = rows.filter((r) => String(r[col]) < iso);
                return chain;
            };
            chain.then = (res: (v: unknown) => unknown) =>
                Promise.resolve({ data: rows, error: null }).then(res);
            return chain;
        };
        return { from } as unknown as SupabaseClient;
    }

    const TXNS = [
        { id: 'txn-1', invoice_ref: 'PRO-1', vessel_name: 'MV A', vessel_id: 'v1', created_at: '2026-06-10T00:00:00Z', tax_amount_usd: '16500', status: 'PENDING' },
        { id: 'txn-2', invoice_ref: 'PRO-2', vessel_name: 'MV B', vessel_id: 'v2', created_at: '2026-06-14T00:00:00Z', tax_amount_usd: '12000', status: 'PARTIALLY_PAID' },
        { id: 'txn-3', invoice_ref: 'PRO-3', vessel_name: 'MV C', vessel_id: 'v1', created_at: '2026-06-16T00:00:00Z', tax_amount_usd: '9000', status: 'PARTIALLY_PAID' },
    ];
    const PAYS = [
        { transaction_id: 'txn-2', shipowner_id: 'own-1', status: 'CONFIRMED', confirmed_at: '2026-06-20T00:00:00Z', receipt_ref: 'RCT-1', amount_usd_minor: '50000' },
        { transaction_id: 'txn-3', shipowner_id: 'own-1', status: 'CONFIRMED', confirmed_at: '2026-06-25T00:00:00Z', receipt_ref: 'RCT-2', amount_usd_minor: '400000' },
    ];
    const BASE = {
        shipownerId: 'own-1',
        periodStart: new Date('2026-06-01T00:00:00Z'),
        periodEnd: new Date('2026-07-01T00:00:00Z'),
        now: new Date('2026-07-01T00:00:00Z'),
    };

    it('compose lignes ouvertes, paiements du mois, totaux', async () => {
        const res = await composeOwnerStatement(makeDb(TXNS, PAYS), BASE);
        expect(res.openCount).toBe(3);
        expect(res.openLines[0]).toMatchObject({ transactionId: 'txn-1', invoiceRef: 'PRO-1', outstandingUsd: 16500 });
        expect(res.openLines[1].outstandingUsd).toBe(11500); // 12000 - 500 encaisses
        expect(res.openLines[2]).toMatchObject({ transactionId: 'txn-3', outstandingUsd: 5000 }); // 9000 - 4000
        expect(res.totalOutstandingUsd).toBe(33000);
        expect(res.paymentsInMonthUsd).toBe(4500);
    });

    it('lit l encaissement dans les paiements, pas dans partial_paid_usd', async () => {
        // `partial_paid_usd` est gelee par la mig 089 et vaut zero sur toute
        // facture en cours : s'y fier reclamait le montant plein.
        const txns = [{ ...TXNS[1], partial_paid_usd: '0' }];
        const res = await composeOwnerStatement(makeDb(txns, PAYS), BASE);
        expect(res.openLines[0].outstandingUsd).toBe(11500);
    });

    it('ecarte une facture annulee, exemptee ou remplacee par un avoir', async () => {
        const txns = [
            { ...TXNS[0], id: 'txn-v', status: 'VOID' },
            { ...TXNS[0], id: 'txn-e', status: 'EXEMPT' },
            { ...TXNS[0], id: 'txn-c', status: 'CREDIT_NOTE_ISSUED' },
        ];
        const res = await composeOwnerStatement(makeDb(txns, []), BASE);
        expect(res.openCount).toBe(0);
        expect(res.totalOutstandingUsd).toBe(0);
    });

    it('n inscrit pas une facture soldee', async () => {
        const txns = [{ ...TXNS[1], status: 'PAID' }];
        const pays = [{ ...PAYS[0], amount_usd_minor: '1200000' }];
        const res = await composeOwnerStatement(makeDb(txns, pays), BASE);
        expect(res.openCount).toBe(0);
    });

    it('arrete le solde a une date passee, sans dependre du statut courant', async () => {
        // Le 15 juin, aucun des deux paiements n'etait encaisse et la 3e
        // facture n'existait pas encore : le solde vaut 16 500 + 12 000.
        const res = await composeOwnerStatement(makeDb(TXNS, PAYS), {
            ...BASE, asOf: new Date('2026-06-15T00:00:00Z'),
        });
        expect(res.openLines.map((l) => l.invoiceRef)).toEqual(['PRO-1', 'PRO-2']);
        expect(res.totalOutstandingUsd).toBe(28500);
        expect(res.asOf.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    });

    it('rend le meme solde quelle que soit la date du calcul', async () => {
        // La reproductibilite est tout l'interet de l'arrete : un consolide au
        // 15 juin doit se recalculer a l'identique des mois plus tard.
        const asOf = new Date('2026-06-15T00:00:00Z');
        const enJuillet = await composeOwnerStatement(makeDb(TXNS, PAYS), { ...BASE, asOf });
        const enDecembre = await composeOwnerStatement(makeDb(TXNS, PAYS), {
            ...BASE, now: new Date('2026-12-31T00:00:00Z'), asOf,
        });
        expect(enDecembre.totalOutstandingUsd).toBe(enJuillet.totalOutstandingUsd);
        expect(enDecembre.openLines.map((l) => l.ageDays)).toEqual(enJuillet.openLines.map((l) => l.ageDays));
    });

    it('restreint le consolide a un navire', async () => {
        const res = await composeOwnerStatement(makeDb(TXNS, PAYS), { ...BASE, vesselId: 'v1' });
        expect(res.openLines.map((l) => l.invoiceRef)).toEqual(['PRO-1', 'PRO-3']);
        expect(res.totalOutstandingUsd).toBe(21500); // 16500 + (9000 - 4000)
    });

    it('date l anciennete depuis l arrete, pas depuis aujourd hui', async () => {
        const res = await composeOwnerStatement(makeDb([TXNS[0]], []), {
            ...BASE, asOf: new Date('2026-06-20T00:00:00Z'),
        });
        expect(res.openLines[0].ageDays).toBe(10);
    });
});
