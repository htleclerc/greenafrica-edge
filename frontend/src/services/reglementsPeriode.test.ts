import { describe, it, expect } from 'vitest';
import { reglementPeriodStart, getReglementsPeriode, isReglementPeriod } from './reglementsPeriode';

describe('reglementPeriodStart', () => {
    // Mercredi 2026-09-09, 14:30 UTC.
    const now = new Date('2026-09-09T14:30:00Z');

    it('fait commencer la semaine le lundi, pas sept jours en arrière', () => {
        // Fenêtre CALENDAIRE : c'est ce que calcule date_trunc('week') côté
        // Postgres. Une fenêtre glissante ferait dire deux choses différentes
        // à deux blocs du même écran.
        expect(reglementPeriodStart('week', now).toISOString()).toBe('2026-09-07T00:00:00.000Z');
    });

    it('rattache le dimanche à la semaine qui s’achève', () => {
        // getUTCDay() rend 0 le dimanche : sans décalage, on prendrait le lundi
        // SUIVANT pour début de semaine et la semaine paraîtrait vide.
        const dimanche = new Date('2026-09-13T23:59:00Z');
        expect(reglementPeriodStart('week', dimanche).toISOString()).toBe('2026-09-07T00:00:00.000Z');
    });

    it('fait commencer le lundi à lui-même', () => {
        const lundi = new Date('2026-09-07T00:00:01Z');
        expect(reglementPeriodStart('week', lundi).toISOString()).toBe('2026-09-07T00:00:00.000Z');
    });

    it('fait commencer le mois au 1er et l’année au 1er janvier', () => {
        expect(reglementPeriodStart('month', now).toISOString()).toBe('2026-09-01T00:00:00.000Z');
        expect(reglementPeriodStart('year', now).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('franchit correctement le passage d’année', () => {
        const nouvelAn = new Date('2026-01-01T00:05:00Z');
        expect(reglementPeriodStart('month', nouvelAn).toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(reglementPeriodStart('week', nouvelAn).toISOString()).toBe('2025-12-29T00:00:00.000Z');
    });
});

describe('isReglementPeriod', () => {
    it('accepte les trois périodes et rejette le reste', () => {
        // Garde le paramètre d'URL : une valeur fantaisiste doit retomber sur
        // le défaut, jamais atteindre la requête.
        expect(isReglementPeriod('week')).toBe(true);
        expect(isReglementPeriod('month')).toBe(true);
        expect(isReglementPeriod('year')).toBe(true);
        expect(isReglementPeriod('decade')).toBe(false);
        expect(isReglementPeriod(undefined)).toBe(false);
    });
});

/** Faux client : une table → un jeu de lignes, quelle que soit la chaîne de filtres. */
function makeDb(tables: Record<string, unknown[]>) {
    const make = (rows: unknown[]) => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'gte', 'in']) b[m] = () => b;
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
        return b;
    };
    return { from: (t: string) => make(tables[t] ?? []) } as never;
}

const now = new Date('2026-09-09T14:30:00Z');
const tx = (o: Record<string, unknown>) => ({
    tax_amount_usd: '1000', paid_usd: '0', outstanding_usd: '1000', is_claimable: true, ...o,
});

describe('getReglementsPeriode', () => {
    it('applique la formule : en attente = dû − encaissé', async () => {
        const db = makeDb({
            v_transaction_outstanding: [tx({ tax_amount_usd: '1000', paid_usd: '400', outstanding_usd: '600' })],
            payments: [],
        });
        const r = await getReglementsPeriode(db, 'month', now);
        expect(r.cohorte).toEqual({ duUsd: 1000, encaisseUsd: 400, enAttenteUsd: 600, invoiceCount: 1 });
    });

    it('normalise les montants rendus en chaînes par PostgREST', async () => {
        // Sans Number(), « 1000 » + « 500 » concatènerait au lieu d'additionner :
        // des montants faux, silencieusement.
        const db = makeDb({
            v_transaction_outstanding: [
                tx({ tax_amount_usd: '1000', outstanding_usd: '1000' }),
                tx({ tax_amount_usd: '500', outstanding_usd: '500' }),
            ],
            payments: [],
        });
        const r = await getReglementsPeriode(db, 'month', now);
        expect(r.cohorte.duUsd).toBe(1500);
        expect(r.cohorte.invoiceCount).toBe(2);
    });

    it('sort une facture annulée du facturé sans la sortir de l’encours', async () => {
        // La vue rend déjà 0 pour VOID : la refiltrer masquerait un trop-perçu
        // au lieu de le laisser voir.
        const db = makeDb({
            v_transaction_outstanding: [
                tx({ is_claimable: false, tax_amount_usd: '900', paid_usd: '900', outstanding_usd: '0' }),
                tx({ tax_amount_usd: '200', paid_usd: '0', outstanding_usd: '200' }),
            ],
            payments: [],
        });
        const r = await getReglementsPeriode(db, 'month', now);
        expect(r.cohorte).toEqual({ duUsd: 200, encaisseUsd: 0, enAttenteUsd: 200, invoiceCount: 1 });
    });

    it('distingue la trésorerie de la cohorte', async () => {
        // Un règlement arrivé ce mois sur une facture d'un autre mois compte
        // dans la trésorerie, jamais dans la cohorte. Les confondre donnerait
        // une image fausse du recouvrement.
        const db = makeDb({
            v_transaction_outstanding: [tx({ paid_usd: '0', outstanding_usd: '1000' })],
            payments: [{ amount_usd_minor: '750000' }, { amount_usd_minor: '250000' }],
        });
        const r = await getReglementsPeriode(db, 'month', now);
        expect(r.cohorte.encaisseUsd).toBe(0);
        expect(r.tresorerie).toEqual({ usd: 10000, count: 2 });
    });

    it('rend des zéros sur une période sans facture', async () => {
        const db = makeDb({ v_transaction_outstanding: [], payments: [] });
        const r = await getReglementsPeriode(db, 'week', now);
        expect(r.cohorte).toEqual({ duUsd: 0, encaisseUsd: 0, enAttenteUsd: 0, invoiceCount: 0 });
        expect(r.tresorerie).toEqual({ usd: 0, count: 0 });
    });

    it('remonte une erreur au lieu de rendre des zéros', async () => {
        // Des zéros sur erreur se liraient « rien facturé ce mois-ci ».
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'gte']) b[m] = () => b;
        b.then = (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: 'boom' } }).then(res);
        const db = { from: () => b } as never;
        await expect(getReglementsPeriode(db, 'month', now)).rejects.toThrow(/boom/);
    });
});
