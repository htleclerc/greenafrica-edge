import { describe, it, expect } from 'vitest';
import { listNaviresRecouvrement, navireCollectionsState } from './navireService';

/** Faux query-builder chaînable : `.from().select().order()` puis résolution. */
function makeDb(rows: Record<string, unknown>[]) {
    const calls: { method: string; args: unknown[] }[] = [];
    const builder: Record<string, unknown> = {};
    builder.select = (...args: unknown[]) => { calls.push({ method: 'select', args }); return builder; };
    builder.order = (...args: unknown[]) => {
        calls.push({ method: 'order', args });
        return Promise.resolve({ data: rows, error: null });
    };
    const db = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return builder; } };
    return { db: db as never, calls };
}

const base = {
    id: 'v1', name: 'GG DEMO STAR', imo_number: '9839272', flag_code: 'SO',
    category: 'CONTAINER', gross_tonnage_dwt: '45000', compliance_status: 'COMPLIANT',
    shipowner_id: 'own-1', shipowner_name: 'Demo Armateur', shipowner_sanctioned: false,
    proforma_count: '2', total_invoiced_usd: '27992', total_paid_usd: '11492',
    total_outstanding_usd: '16500', open_count: '1', overdue_count: '1',
    next_due_date: '2026-05-26T00:00:00Z', last_invoiced_at: '2026-04-26T00:00:00Z',
};

describe('listNaviresRecouvrement', () => {
    it('interroge la vue et trie par encours décroissant', async () => {
        const { db, calls } = makeDb([base]);
        await listNaviresRecouvrement(db);
        expect(calls.find((c) => c.method === 'from')?.args[0]).toBe('v_navire_recouvrement');
        expect(calls.find((c) => c.method === 'order')?.args)
            .toEqual(['total_outstanding_usd', { ascending: false }]);
    });

    it('normalise les NUMERIC et BIGINT rendus en chaînes par PostgREST', async () => {
        // Sans Number(), « 27992 » + « 16500 » concatènerait au lieu d'additionner :
        // des montants faux, silencieusement.
        const { db } = makeDb([base]);
        const [r] = await listNaviresRecouvrement(db);
        expect(r.total_invoiced_usd).toBe(27992);
        expect(r.total_paid_usd).toBe(11492);
        expect(r.total_outstanding_usd).toBe(16500);
        expect(r.gross_tonnage_dwt).toBe(45000);
        expect(r.proforma_count).toBe(2);
        expect(r.open_count).toBe(1);
        expect(r.overdue_count).toBe(1);
    });

    it('tolère un navire sans armateur rattaché', async () => {
        // 10 des 12 navires de l'environnement de recette sont dans ce cas.
        const { db } = makeDb([{ ...base, shipowner_id: null, shipowner_name: null, next_due_date: null }]);
        const [r] = await listNaviresRecouvrement(db);
        expect(r.shipowner_id).toBeNull();
        expect(r.shipowner_name).toBeNull();
        expect(r.next_due_date).toBeNull();
    });

    it('remonte une erreur de la vue au lieu de rendre une liste vide', async () => {
        // Une liste vide sur erreur ferait croire « aucun navire ne doit rien ».
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.order = () => Promise.resolve({ data: null, error: { message: 'boom' } });
        const db = { from: () => builder } as never;
        await expect(listNaviresRecouvrement(db)).rejects.toThrow(/boom/);
    });
});

describe('navireCollectionsState', () => {
    it('signale le retard avant tout le reste', () => {
        expect(navireCollectionsState({ open_count: 3, overdue_count: 1 })).toBe('OVERDUE');
    });

    it('distingue une créance ouverte à jour', () => {
        expect(navireCollectionsState({ open_count: 2, overdue_count: 0 })).toBe('OPEN');
    });

    it('distingue un navire soldé d’un navire jamais facturé', () => {
        // Les deux affichent zéro dû ; les confondre masquerait un navire qui
        // n'est jamais passé par la facturation.
        expect(navireCollectionsState({ open_count: 0, overdue_count: 0, proforma_count: 4 })).toBe('SETTLED');
        expect(navireCollectionsState({ open_count: 0, overdue_count: 0, proforma_count: 0 })).toBe('NEVER_INVOICED');
    });
});
