import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mutable state shared across mock chains ──────────────────────────────────
let membershipRow: { jurisdiction_id: string } | null = { jurisdiction_id: 'jur-1' };
let profileRow: { full_name: string } | null = { full_name: 'Test User' };
const auditInsertCalls: unknown[] = [];
let auditInsertShouldThrow = false;
const cookieSetCalls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];

// ── Supabase session client mock ─────────────────────────────────────────────
const mockSupabase = {
    auth: {
        getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-1', email: 'user@test.com' } },
        }),
    },
    from: vi.fn((table: string) => {
        if (table === 'user_jurisdictions') {
            return {
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({ data: membershipRow, error: null }),
                        }),
                    }),
                }),
            };
        }
        if (table === 'profiles') {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: profileRow, error: null }),
                    }),
                }),
            };
        }
        if (table === 'audit_logs') {
            return {
                insert: async (row: unknown) => {
                    auditInsertCalls.push(row);
                    if (auditInsertShouldThrow) throw new Error('audit insert failed');
                    return { error: null };
                },
            };
        }
        return {} as never;
    }),
};

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

// Les pays accessibles sont résolus par un module testé à part (administrateur
// général = tous les pays ; personnel = ses rattachements). Ici, `membershipRow`
// non nul veut dire « le pays demandé en fait partie ».
let accessibleShouldThrow = false;
vi.mock('@/lib/auth/accessibleJurisdictions', () => ({
    listAccessibleJurisdictions: vi.fn(async () => {
        if (accessibleShouldThrow) throw new Error('lecture impossible');
        return {
            isGeneralAdmin: false,
            jurisdictions: membershipRow ? [{ id: VALID_UUID, code: 'SO', name: 'Somaliland' }] : [],
        };
    }),
}));

// ── Cookie mock ───────────────────────────────────────────────────────────────
const mockCookieSet = vi.fn((name: string, value: string, options: Record<string, unknown>) => {
    cookieSetCalls.push({ name, value, options });
});
vi.mock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({ set: mockCookieSet }),
}));

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

// Dynamic import after mocks are set up
async function getSUT() {
    const { setActiveJurisdiction } = await import('./setActiveJurisdiction');
    return setActiveJurisdiction;
}

describe('setActiveJurisdiction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        membershipRow = { jurisdiction_id: 'jur-1' };
        profileRow = { full_name: 'Test User' };
        auditInsertCalls.length = 0;
        cookieSetCalls.length = 0;
        auditInsertShouldThrow = false;
        accessibleShouldThrow = false;
        mockSupabase.auth.getUser.mockResolvedValue({
            data: { user: { id: 'user-1', email: 'user@test.com' } },
        });
    });

    it('returns error on invalid UUID', async () => {
        const fn = await getSUT();
        const result = await fn({ jurisdictionId: 'not-a-uuid' });
        expect(result).toMatchObject({ ok: false });
    });

    it('returns error when user is unauthenticated', async () => {
        mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });
        const fn = await getSUT();
        const result = await fn({ jurisdictionId: VALID_UUID });
        expect(result).toMatchObject({ ok: false, error: 'not authenticated' });
    });

    it('returns error when user is not a member of the jurisdiction', async () => {
        membershipRow = null;
        const fn = await getSUT();
        const result = await fn({ jurisdictionId: VALID_UUID });
        expect(result).toMatchObject({ ok: false, error: 'not a member of this jurisdiction' });
    });

    it('sets cookie with secure:true in production', async () => {
        const origEnv = process.env.NODE_ENV;
        // @ts-expect-error NODE_ENV is nominally read-only but writable in vitest's Node context
        process.env.NODE_ENV = 'production';
        const fn = await getSUT();
        const result = await fn({ jurisdictionId: VALID_UUID });
        expect(result).toMatchObject({ ok: true });
        expect(mockCookieSet).toHaveBeenCalledOnce();
        const [, , options] = mockCookieSet.mock.calls[0];
        expect(options).toMatchObject({
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secure: true,
        });
        // @ts-expect-error NODE_ENV is nominally read-only but writable in vitest's Node context
        process.env.NODE_ENV = origEnv;
    });

    it('sets cookie with secure:false outside production', async () => {
        const fn = await getSUT();
        // NODE_ENV is 'test' in vitest
        await fn({ jurisdictionId: VALID_UUID });
        const [, , options] = mockCookieSet.mock.calls[0];
        expect(options.secure).toBe(false);
    });

    it('writes audit log with ACTIVE_JURISDICTION_SWITCHED event on success', async () => {
        const fn = await getSUT();
        const result = await fn({ jurisdictionId: VALID_UUID });
        expect(result).toMatchObject({ ok: true });
        expect(auditInsertCalls).toHaveLength(1);
        expect(auditInsertCalls[0]).toMatchObject({
            user_id: 'user-1',
            user_full_name: 'Test User',
            action: 'TRANSACTION_UPDATED',
            severity: 'INFO',
            entity_type: 'Jurisdiction',
            entity_id: VALID_UUID,
            details_json: { event: 'ACTIVE_JURISDICTION_SWITCHED' },
        });
    });

    it('falls back to email when profile has no full_name', async () => {
        profileRow = null;
        const fn = await getSUT();
        await fn({ jurisdictionId: VALID_UUID });
        expect(auditInsertCalls[0]).toMatchObject({ user_full_name: 'user@test.com' });
    });

    it('still returns ok when audit insert throws (fail-soft)', async () => {
        auditInsertShouldThrow = true;
        const fn = await getSUT();
        const result = await fn({ jurisdictionId: VALID_UUID });
        // Cookie was already set; switch succeeds even though audit insert throws.
        expect(result).toMatchObject({ ok: true });
    });

    it('refuses, without writing the cookie, when accessible jurisdictions cannot be read', async () => {
        accessibleShouldThrow = true;
        const setActiveJurisdiction = await getSUT();
        const res = await setActiveJurisdiction({ jurisdictionId: VALID_UUID });
        expect(res).toEqual({ ok: false, error: 'jurisdictions unavailable' });
        expect(cookieSetCalls).toHaveLength(0);
    });
});
