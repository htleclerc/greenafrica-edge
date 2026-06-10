import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _getServerJurisdictionIdImpl } from './tenantContext';

const SO = '00000000-0000-4000-8000-00000000534f';
const SN = '11111111-1111-4111-8111-111111111111';

// ── Configurable fake SSR client ────────────────────────────────────────────
let authUser: { id: string } | null;
let ownerRow: { jurisdiction_id: string } | null;
let membershipRows: Array<{ jurisdiction_id: string }>;
let activeCookieValue: string | undefined;

const mockClient = {
    auth: {
        getUser: async () => ({
            data: { user: authUser },
            error: authUser ? null : { message: 'no user' },
        }),
    },
    from: (table: string) => {
        if (table === 'shipowners') {
            return {
                select: () => ({
                    eq: () => ({ maybeSingle: async () => ({ data: ownerRow, error: null }) }),
                }),
            };
        }
        if (table === 'user_jurisdictions') {
            return {
                select: () => ({ eq: async () => ({ data: membershipRows, error: null }) }),
            };
        }
        throw new Error(`unexpected table ${table}`);
    },
};

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => mockClient,
}));

// Mock next/headers cookies
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (_name: string) => (activeCookieValue !== undefined ? { value: activeCookieValue } : undefined),
    }),
}));

beforeEach(() => {
    authUser = { id: 'user-1' };
    ownerRow = null;
    membershipRows = [];
    activeCookieValue = undefined;
    vi.resetModules();
});

describe('getServerJurisdictionId', () => {
    it('returns the operator home jurisdiction for an owner', async () => {
        ownerRow = { jurisdiction_id: SO };
        await expect(_getServerJurisdictionIdImpl()).resolves.toBe(SO);
    });

    it('returns the single membership jurisdiction for staff (no owner row)', async () => {
        membershipRows = [{ jurisdiction_id: SO }];
        await expect(_getServerJurisdictionIdImpl()).resolves.toBe(SO);
    });

    it('multi-juri + valid cookie in memberships → returns cookie value', async () => {
        membershipRows = [{ jurisdiction_id: SO }, { jurisdiction_id: SN }];
        activeCookieValue = SO;
        await expect(_getServerJurisdictionIdImpl()).resolves.toBe(SO);
    });

    it('multi-juri + no cookie → throws with select an active jurisdiction', async () => {
        membershipRows = [{ jurisdiction_id: SO }, { jurisdiction_id: SN }];
        activeCookieValue = undefined;
        await expect(_getServerJurisdictionIdImpl()).rejects.toThrow(/select an active jurisdiction/);
    });

    it('multi-juri + cookie NOT in memberships → throws', async () => {
        membershipRows = [{ jurisdiction_id: SO }, { jurisdiction_id: SN }];
        activeCookieValue = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
        await expect(_getServerJurisdictionIdImpl()).rejects.toThrow(/select an active jurisdiction/);
    });

    it('single-juri → returns it and ignores any cookie', async () => {
        membershipRows = [{ jurisdiction_id: SO }];
        activeCookieValue = SN; // cookie points elsewhere but should be ignored
        await expect(_getServerJurisdictionIdImpl()).resolves.toBe(SO);
    });

    it('throws for multi-jurisdiction staff (needs explicit switcher)', async () => {
        membershipRows = [{ jurisdiction_id: SO }, { jurisdiction_id: SN }];
        await expect(_getServerJurisdictionIdImpl()).rejects.toThrow(/multi-jurisdiction/);
    });

    it('throws when no jurisdiction can be resolved (fail-closed)', async () => {
        ownerRow = null;
        membershipRows = [];
        await expect(_getServerJurisdictionIdImpl()).rejects.toThrow(/no jurisdiction resolved/);
    });

    it('throws when there is no authenticated user', async () => {
        authUser = null;
        await expect(_getServerJurisdictionIdImpl()).rejects.toThrow(/no authenticated user/);
    });

    it('prefers the owner path over staff memberships', async () => {
        ownerRow = { jurisdiction_id: SN };
        membershipRows = [{ jurisdiction_id: SO }];
        await expect(_getServerJurisdictionIdImpl()).resolves.toBe(SN);
    });
});
