import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTenantClient, createPlatformClient, TENANT_SCOPED_TABLES } from './tenant';

const JID = '00000000-0000-4000-8000-00000000534f';

// ── Recording fake supabase client ──────────────────────────────────────────
// Each builder method records the call; .eq() records the column/value applied.
interface Rec {
    table: string;
    method: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
    args: unknown[];
    eq: Array<[string, unknown]>;
}
let records: Rec[] = [];

function fakeFrom(table: string) {
    const mk = (method: Rec['method'], args: unknown[]) => {
        const rec: Rec = { table, method, args, eq: [] };
        records.push(rec);
        const filter = {
            eq: (col: string, val: unknown) => {
                rec.eq.push([col, val]);
                return filter;
            },
        };
        return filter;
    };
    return {
        select: (...args: unknown[]) => mk('select', args),
        insert: (...args: unknown[]) => mk('insert', args),
        update: (...args: unknown[]) => mk('update', args),
        upsert: (...args: unknown[]) => mk('upsert', args),
        delete: (...args: unknown[]) => mk('delete', args),
    };
}

const mockClient = {
    from: (table: string) => fakeFrom(table),
    rpc: () => ({}),
    storage: { from: () => ({}) },
    auth: {},
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => mockClient,
}));

beforeEach(() => {
    records = [];
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

const jidEq = (rec: Rec) => rec.eq.some(([c, v]) => c === 'jurisdiction_id' && v === JID);

describe('createTenantClient — guards', () => {
    it('throws when jurisdictionId is missing', () => {
        expect(() => createTenantClient('')).toThrow(/jurisdictionId is required/);
    });

    it('throws when service env is not configured', () => {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        expect(() => createTenantClient(JID)).toThrow(/must be set/);
    });
});

describe('createTenantClient — tenant-scoped tables auto-filter', () => {
    it('select on a scoped table appends .eq(jurisdiction_id)', () => {
        createTenantClient(JID).from('payments').select('*');
        const rec = records.find((r) => r.method === 'select')!;
        expect(rec.table).toBe('payments');
        expect(jidEq(rec)).toBe(true);
    });

    it('delete on a scoped table appends .eq(jurisdiction_id)', () => {
        createTenantClient(JID).from('refunds').delete();
        expect(jidEq(records.find((r) => r.method === 'delete')!)).toBe(true);
    });

    it('insert stamps jurisdiction_id on a single row', () => {
        createTenantClient(JID).from('wallets').insert({ shipowner_id: 'x' });
        const rec = records.find((r) => r.method === 'insert')!;
        expect(rec.args[0]).toEqual({ shipowner_id: 'x', jurisdiction_id: JID });
    });

    it('insert stamps jurisdiction_id on every row of an array', () => {
        createTenantClient(JID).from('owner_notifications').insert([{ a: 1 }, { a: 2 }]);
        const rec = records.find((r) => r.method === 'insert')!;
        expect(rec.args[0]).toEqual([
            { a: 1, jurisdiction_id: JID },
            { a: 2, jurisdiction_id: JID },
        ]);
    });

    it('insert OVERRIDES a caller-supplied jurisdiction_id (no cross-tenant insert)', () => {
        createTenantClient(JID).from('payments').insert({ jurisdiction_id: 'evil-other-tenant' });
        const rec = records.find((r) => r.method === 'insert')!;
        expect((rec.args[0] as Record<string, unknown>).jurisdiction_id).toBe(JID);
    });

    it('update STRIPS jurisdiction_id from values and appends .eq (no cross-tenant move)', () => {
        createTenantClient(JID)
            .from('shipowners')
            .update({ name: 'New', jurisdiction_id: 'evil-other-tenant' });
        const rec = records.find((r) => r.method === 'update')!;
        expect(rec.args[0]).toEqual({ name: 'New' }); // jurisdiction_id stripped
        expect(jidEq(rec)).toBe(true);
    });

    it('covers all 10 tenant-scoped tables in the allowlist', () => {
        for (const t of TENANT_SCOPED_TABLES) {
            records = [];
            createTenantClient(JID).from(t).select('*');
            expect(jidEq(records.find((r) => r.method === 'select')!)).toBe(true);
        }
    });
});

describe('createTenantClient — non-scoped tables pass through', () => {
    it('does NOT inject jurisdiction_id on a non-scoped table', () => {
        createTenantClient(JID).from('profiles').select('*');
        const rec = records.find((r) => r.method === 'select')!;
        expect(rec.table).toBe('profiles');
        expect(jidEq(rec)).toBe(false);
    });

    it('delegates non-from members (e.g. rpc) to the base client', () => {
        const client = createTenantClient(JID);
        expect(typeof client.rpc).toBe('function');
    });
});

describe('createPlatformClient — explicitly unscoped', () => {
    it('does NOT inject jurisdiction_id even on a scoped table', () => {
        createPlatformClient().from('payments').select('*');
        const rec = records.find((r) => r.method === 'select')!;
        expect(jidEq(rec)).toBe(false);
    });
});

afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});
