import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseInvoiceFilters, listInvoicesAdmin, listInvoiceFilterOptions } from './invoiceAdminService';

describe('parseInvoiceFilters', () => {
    it('applique les défauts page=1 pageSize=25 quand rien n’est fourni', () => {
        const f = parseInvoiceFilters({});
        expect(f.page).toBe(1);
        expect(f.pageSize).toBe(25);
        expect(f.documentType).toBeUndefined();
        expect(f.dueOnly).toBe(false);
    });

    it('clampe pageSize dans [1,100]', () => {
        expect(parseInvoiceFilters({ pageSize: '0' }).pageSize).toBe(1);
        expect(parseInvoiceFilters({ pageSize: '500' }).pageSize).toBe(100);
        expect(parseInvoiceFilters({ pageSize: '50' }).pageSize).toBe(50);
    });

    it('force page >= 1', () => {
        expect(parseInvoiceFilters({ page: '0' }).page).toBe(1);
        expect(parseInvoiceFilters({ page: '-3' }).page).toBe(1);
        expect(parseInvoiceFilters({ page: '4' }).page).toBe(4);
    });

    it('ignore une énumération invalide (documentType, mode)', () => {
        expect(parseInvoiceFilters({ documentType: 'BOGUS' }).documentType).toBeUndefined();
        expect(parseInvoiceFilters({ documentType: 'PROFORMA' }).documentType).toBe('PROFORMA');
        expect(parseInvoiceFilters({ mode: 'ROCKET' }).mode).toBeUndefined();
        expect(parseInvoiceFilters({ mode: 'AIR' }).mode).toBe('AIR');
    });

    it('interprète dueOnly', () => {
        expect(parseInvoiceFilters({ dueOnly: '1' }).dueOnly).toBe(true);
        expect(parseInvoiceFilters({ dueOnly: 'true' }).dueOnly).toBe(true);
        expect(parseInvoiceFilters({ dueOnly: '0' }).dueOnly).toBe(false);
        expect(parseInvoiceFilters({ dueOnly: 'no' }).dueOnly).toBe(false);
    });

    it('trim la recherche et traite le vide comme undefined', () => {
        expect(parseInvoiceFilters({ search: '  ABC ' }).search).toBe('ABC');
        expect(parseInvoiceFilters({ search: '   ' }).search).toBeUndefined();
    });

    it('valide les dates YYYY-MM-DD et rejette le reste', () => {
        expect(parseInvoiceFilters({ dateFrom: '2026-05-01' }).dateFrom).toBe('2026-05-01');
        expect(parseInvoiceFilters({ dateFrom: '01/05/2026' }).dateFrom).toBeUndefined();
        expect(parseInvoiceFilters({ dateTo: 'hier' }).dateTo).toBeUndefined();
    });

    it('prend la première valeur si le param est un tableau', () => {
        expect(parseInvoiceFilters({ mode: ['AIR', 'MARITIME'] }).mode).toBe('AIR');
    });
});

// Chaîne de query builder mockée ; le terminal .range() résout {data,count,error}.
function makeChain(result: { data: unknown[]; count: number | null }) {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gt', 'gte', 'lte', 'or', 'order']) {
        chain[m] = vi.fn(() => chain);
    }
    chain.range = vi.fn(() => Promise.resolve({ data: result.data, count: result.count, error: null }));
    return chain;
}

// Faux query-builder chaînable capturant les appels (mêmes patron que collectionAdminService.test.ts),
// utile pour asserter l'ordre exact des appels .order() successifs.
function makeDb(rows: Record<string, unknown>[], count: number) {
    const calls: { method: string; args: unknown[] }[] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gt', 'gte', 'lte', 'or', 'order']) {
        builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
    }
    builder.range = (..._args: unknown[]) => {
        calls.push({ method: 'range', args: _args });
        return Promise.resolve({ data: rows, count, error: null });
    };
    const db = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return builder; } };
    return { db: db as never, calls };
}

describe('listInvoicesAdmin', () => {
    it('interroge la vue, applique les filtres et pagine via range', async () => {
        const chain = makeChain({ data: [], count: 0 });
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        await listInvoicesAdmin(db, {
            mode: 'AIR', dueOnly: true, search: 'ABC', page: 2, pageSize: 10,
        });
        expect(db.from).toHaveBeenCalledWith('v_invoice_admin');
        expect(chain.eq).toHaveBeenCalledWith('mode', 'AIR');
        expect(chain.gt).toHaveBeenCalledWith('outstanding_usd', 0);
        expect(chain.or).toHaveBeenCalled();
        // page 2, pageSize 10 => range(10, 19)
        expect(chain.range).toHaveBeenCalledWith(10, 19);
    });

    it('renvoie total depuis le count et normalise les nombres', async () => {
        const chain = makeChain({
            data: [{
                id: 'tx-1', invoice_ref: 'INV-1', content_hash: null, verify_signature: null,
                document_type: 'PROFORMA', mode: 'MARITIME', status: 'PENDING',
                tax_amount_usd: '100.5', partial_paid_usd: '40', outstanding_usd: '60.5',
                created_at: '2026-05-01T00:00:00Z', due_date: null, paid_at: null,
                vessel_name: 'MV Test', vessel_imo: 'UNVERIFIED-1', shipowner_id: 'so-1',
                debtor_name: 'Acme', flag_country: 'SO', jurisdiction_id: 'j-1',
                jurisdiction_code: 'SOMALILAND', jurisdiction_name: 'Somaliland', is_aviation: false,
            }],
            count: 87,
        });
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        const res = await listInvoicesAdmin(db, { page: 1, pageSize: 25 });
        expect(res.total).toBe(87);
        expect(res.page).toBe(1);
        expect(res.rows[0].tax_amount_usd).toBe(100.5);
        expect(res.rows[0].outstanding_usd).toBe(60.5);
    });

    it('n’applique pas de filtre eq quand les champs sont absents', async () => {
        const chain = makeChain({ data: [], count: 0 });
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        await listInvoicesAdmin(db, { page: 1, pageSize: 25 });
        expect(chain.eq).not.toHaveBeenCalled();
        expect(chain.gt).not.toHaveBeenCalled();
        expect(chain.or).not.toHaveBeenCalled();
    });

    it('trie sur une clé autorisée', async () => {
        const { db, calls } = makeDb([], 0);
        await listInvoicesAdmin(db, { page: 1, pageSize: 25, sortKey: 'tax_amount_usd', sortDir: 'asc' });
        const orderCalls = calls.filter((c) => c.method === 'order');
        expect(orderCalls[0]).toEqual({ method: 'order', args: ['tax_amount_usd', { ascending: true }] });
    });

    it('ignore une clé de tri hors liste blanche', async () => {
        const { db, calls } = makeDb([], 0);
        await listInvoicesAdmin(db, { page: 1, pageSize: 25, sortKey: 'evil; DROP TABLE', sortDir: 'asc' });
        const orderCalls = calls.filter((c) => c.method === 'order');
        expect(orderCalls[0].args[0]).toBe('created_at');
    });
});

describe('listInvoiceFilterOptions', () => {
    it('charge les juridictions et déduplique les pavillons', async () => {
        const jchain = {
            select: vi.fn(() => jchain),
            order: vi.fn(() => Promise.resolve({ data: [{ id: 'j-1', name: 'Somaliland' }], error: null })),
        };
        const fchain = {
            select: vi.fn(() => Promise.resolve({
                data: [{ flag_country: 'SO' }, { flag_country: 'SO' }, { flag_country: 'DJ' }, { flag_country: null }],
                error: null,
            })),
        };
        const db = {
            from: vi.fn((t: string) => (t === 'jurisdictions' ? jchain : fchain)),
        } as unknown as SupabaseClient;
        const res = await listInvoiceFilterOptions(db);
        expect(res.jurisdictions).toEqual([{ id: 'j-1', name: 'Somaliland' }]);
        expect(res.flagCountries.sort()).toEqual(['DJ', 'SO']);
    });

    it('rejette quand la requête jurisdictions échoue au lieu de renvoyer des listes vides', async () => {
        const jchain = {
            select: vi.fn(() => jchain),
            order: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
        };
        const fchain = {
            select: vi.fn(() => Promise.resolve({
                data: [{ flag_country: 'SO' }],
                error: null,
            })),
        };
        const db = {
            from: vi.fn((t: string) => (t === 'jurisdictions' ? jchain : fchain)),
        } as unknown as SupabaseClient;
        await expect(listInvoiceFilterOptions(db)).rejects.toThrow();
    });

    it('rejette quand la requête v_invoice_admin (pavillons) échoue', async () => {
        const jchain = {
            select: vi.fn(() => jchain),
            order: vi.fn(() => Promise.resolve({ data: [{ id: 'j-1', name: 'Somaliland' }], error: null })),
        };
        const fchain = {
            select: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
        };
        const db = {
            from: vi.fn((t: string) => (t === 'jurisdictions' ? jchain : fchain)),
        } as unknown as SupabaseClient;
        await expect(listInvoiceFilterOptions(db)).rejects.toThrow();
    });
});
