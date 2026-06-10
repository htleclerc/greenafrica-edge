import { describe, it, expect, vi, beforeEach } from 'vitest';

const COOKIE_NAME = 'gg-active-jid';
const VALID_UUID = '00000000-0000-4000-8000-000000000001';

// ── Mock: supabase session client ────────────────────────────────────────────
const mockServer = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
};
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => mockServer) }));

// ── Mock: tenantContext (just export the constant) ───────────────────────────
vi.mock('@/lib/auth/tenantContext', () => ({
    ACTIVE_JURISDICTION_COOKIE: COOKIE_NAME,
}));

// ── Mock: next/headers cookies ───────────────────────────────────────────────
const mockCookieSet = vi.fn();
vi.mock('next/headers', () => ({
    cookies: async () => ({ set: mockCookieSet }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function maybeSingle(value: unknown) {
    return {
        select: () => ({
            eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: value, error: null }) }),
            }),
        }),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
});

describe('setActiveJurisdiction', () => {
    it('invalid uuid → ok:false, error: invalid input', async () => {
        const { setActiveJurisdiction } = await import('./setActiveJurisdiction');
        const r = await setActiveJurisdiction({ jurisdictionId: 'not-a-uuid' });
        expect(r).toEqual({ ok: false, error: 'invalid input' });
        expect(mockCookieSet).not.toHaveBeenCalled();
    });

    it('no user session → ok:false, error: not authenticated', async () => {
        mockServer.auth.getUser.mockResolvedValue({ data: { user: null } });
        const { setActiveJurisdiction } = await import('./setActiveJurisdiction');
        const r = await setActiveJurisdiction({ jurisdictionId: VALID_UUID });
        expect(r).toEqual({ ok: false, error: 'not authenticated' });
        expect(mockCookieSet).not.toHaveBeenCalled();
    });

    it('non-member → ok:false, error: not a member, cookie NOT set', async () => {
        mockServer.from.mockReturnValue(maybeSingle(null));
        const { setActiveJurisdiction } = await import('./setActiveJurisdiction');
        const r = await setActiveJurisdiction({ jurisdictionId: VALID_UUID });
        expect(r).toEqual({ ok: false, error: 'not a member of this jurisdiction' });
        expect(mockCookieSet).not.toHaveBeenCalled();
    });

    it('member → ok:true, cookie set with correct name and options', async () => {
        mockServer.from.mockReturnValue(maybeSingle({ jurisdiction_id: VALID_UUID }));
        const { setActiveJurisdiction } = await import('./setActiveJurisdiction');
        const r = await setActiveJurisdiction({ jurisdictionId: VALID_UUID });
        expect(r).toEqual({ ok: true });
        expect(mockCookieSet).toHaveBeenCalledOnce();
        const [name, value, opts] = mockCookieSet.mock.calls[0];
        expect(name).toBe(COOKIE_NAME);
        expect(value).toBe(VALID_UUID);
        expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
        expect(typeof opts.maxAge).toBe('number');
        expect(opts.maxAge).toBeGreaterThan(0);
    });
});
