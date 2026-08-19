import { describe, it, expect } from 'vitest';
import {
    parseCollectionFilters, listCollectionsAdmin, tierVariant, responseVariant,
    DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE,
} from './collectionAdminService';

describe('parseCollectionFilters', () => {
    it('applique les défauts sur une entrée vide', () => {
        const f = parseCollectionFilters({});
        expect(f).toMatchObject({ q: undefined, jurisdictionId: undefined, status: undefined,
            latestTier: undefined, latestResponse: undefined, page: 1, pageSize: DEFAULT_PAGE_SIZE });
    });

    it('clampe page et pageSize', () => {
        expect(parseCollectionFilters({ page: '0', pageSize: '999' }))
            .toMatchObject({ page: 1, pageSize: MAX_PAGE_SIZE });
        expect(parseCollectionFilters({ page: '3', pageSize: '10' }))
            .toMatchObject({ page: 3, pageSize: 10 });
    });

    it('ne casse pas sur un champ invalide (catch → défaut)', () => {
        const f = parseCollectionFilters({ page: 'abc', pageSize: 'xyz', jurisdictionId: '  ' });
        expect(f.page).toBe(1);
        expect(f.pageSize).toBe(DEFAULT_PAGE_SIZE);
        expect(f.jurisdictionId).toBeUndefined();
    });

    it('collapse un tableau de valeurs en la première', () => {
        expect(parseCollectionFilters({ status: ['PENDING', 'OVERDUE'] }).status).toBe('PENDING');
    });
});

describe('tierVariant / responseVariant', () => {
    it('mappe chaque palier vers un BadgeVariant', () => {
        expect(tierVariant('J3')).toBe('info');
        expect(tierVariant('J15')).toBe('warning');
        expect(tierVariant('J30')).toBe('overdue');
        expect(tierVariant('J45')).toBe('critical');
        expect(tierVariant('BAILIFF')).toBe('critical');
        expect(tierVariant('JUDICIAL')).toBe('critical');
        expect(tierVariant(null)).toBe('draft');
    });

    it('mappe chaque réponse débiteur vers un BadgeVariant', () => {
        expect(responseVariant('PAID')).toBe('paid');
        expect(responseVariant('DISPUTE')).toBe('disputed');
        expect(responseVariant('PAYMENT_PROMISE')).toBe('warning');
        expect(responseVariant('PARTIAL_PAYMENT')).toBe('warning');
        expect(responseVariant('ACKNOWLEDGE')).toBe('info');
        expect(responseVariant('REFUSED')).toBe('critical');
        expect(responseVariant('SILENT')).toBe('draft');
        expect(responseVariant(null)).toBe('draft');
    });
});

describe('listCollectionsAdmin', () => {
    // Faux query-builder chaînable capturant les appels.
    function makeDb(rows: Record<string, unknown>[], count: number) {
        const calls: { method: string; args: unknown[] }[] = [];
        const builder: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'gt', 'or', 'order']) {
            builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
        }
        builder.range = (..._args: unknown[]) => {
            calls.push({ method: 'range', args: _args });
            return Promise.resolve({ data: rows, count, error: null });
        };
        const db = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return builder; } };
        return { db: db as never, calls };
    }

    it('interroge la vue, applique filtres + recherche échappée + pagination', async () => {
        const { db, calls } = makeDb([{ transaction_id: 'tx1', tax_amount_usd: '100', outstanding_usd: '100', reminder_count: '2' }], 1);
        const page = await listCollectionsAdmin(db, {
            q: 'ACME%,(x)', jurisdictionId: 'jur-1', status: 'PENDING',
            latestTier: 'J15', latestResponse: 'SILENT', page: 2, pageSize: 25,
        });
        expect(calls.find((c) => c.method === 'from')?.args[0]).toBe('v_collection_admin');
        // recherche échappée (%,() remplacés par espaces)
        const orCall = calls.find((c) => c.method === 'or');
        const orArg = String(orCall?.args[0]);
        // escapeSearch replaced % , ( ) with spaces; the term 'ACME%,(x)' becomes 'ACME   x '
        // sans échappement, orArg contiendrait la séquence brute 'ACME%,(x)' → ces assertions
        // échoueraient si escapeSearch était retiré.
        expect(orArg).toContain('invoice_ref.ilike.%');   // wildcard ILIKE toujours présent
        expect(orArg).not.toContain('%,(');                // séquence brute non échappée absente
        expect(orArg).not.toContain('(x)');                // parenthèses utilisateur absentes
        // tri : latest_sent_at desc puis transaction_id asc (départage déterministe des égalités)
        const orderCalls = calls.filter((c) => c.method === 'order');
        expect(orderCalls).toEqual([
            { method: 'order', args: ['latest_sent_at', { ascending: false }] },
            { method: 'order', args: ['transaction_id', { ascending: true }] },
        ]);
        // pagination : range(offset=25, 49)
        const rangeCall = calls.find((c) => c.method === 'range');
        expect(rangeCall?.args).toEqual([25, 49]);
        expect(page).toMatchObject({ total: 1, page: 2, pageSize: 25 });
        expect(page.rows[0]).toMatchObject({ transaction_id: 'tx1', tax_amount_usd: 100, reminder_count: 2 });
    });
});
