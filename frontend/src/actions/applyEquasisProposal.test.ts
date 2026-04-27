import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Spies ───────────────────────────────────────────────────────────────────

const upsertEmailSpy = vi.fn(
    async (_db: unknown, _ownerId: string, _email: string, _src: string) => ({
        id: 'owner-uuid',
        official_email_source: 'EQUASIS_VERIFIED' as const,
    }),
);
const getOrCreateGhostSpy = vi.fn(async () => ({ id: 'ghost-uuid', name: 'GHOST' }));
const proposalUpdateSpy = vi.fn((_p: Record<string, unknown>) => ({
    eq: () => Promise.resolve({ error: null }),
}));
const shipownerUpdateSpy = vi.fn(() => ({
    eq: () => Promise.resolve({ error: null }),
}));
const auditInsertSpy = vi.fn(() => Promise.resolve({ error: null }));

// ── Mutable state ───────────────────────────────────────────────────────────

let callerProfile: { role: string; full_name: string | null } | null = {
    role: 'PORT_OFFICER',
    full_name: 'Officer A',
};
let callerUser: { id: string } | null = { id: 'officer-uuid' };
let mockProposal: {
    id: string;
    imo_number: string;
    shipowner_id: string | null;
    proposed_owner_name: string | null;
    proposed_manager: string | null;
    proposed_email: string | null;
    proposed_country: string | null;
    applied: boolean;
    reviewed_at: string | null;
} | null = {
    id: 'proposal-uuid',
    imo_number: '9876543',
    shipowner_id: 'owner-uuid',
    proposed_owner_name: 'Acme Maritime Ltd',
    proposed_manager: null,
    proposed_email: 'ops@acme.com',
    proposed_country: 'PA',
    applied: false,
    reviewed_at: null,
};
let mockVessel: { shipowner_id: string | null } | null = { shipowner_id: 'owner-uuid' };
let mockShipowner: {
    name: string | null;
    country_code: string | null;
    official_email_source: string | null;
} = { name: null, country_code: null, official_email_source: null };

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/services/shipownerService', () => ({
    upsertShipownerEmail: upsertEmailSpy,
    getOrCreateGhost: getOrCreateGhostSpy,
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: () =>
        Promise.resolve({
            auth: {
                getUser: () => Promise.resolve({ data: { user: callerUser } }),
            },
            from: (table: string) => {
                if (table === 'profiles') {
                    return {
                        select: () => ({
                            eq: () => ({
                                single: () =>
                                    Promise.resolve({ data: callerProfile, error: null }),
                            }),
                        }),
                    };
                }
                throw new Error(`unexpected table on user client: ${table}`);
            },
        }),
}));

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({
        from: (table: string) => {
            if (table === 'equasis_scrape_proposals') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: () =>
                                Promise.resolve({
                                    data: mockProposal,
                                    error: mockProposal ? null : { message: 'not found' },
                                }),
                        }),
                    }),
                    update: (payload: Record<string, unknown>) => {
                        proposalUpdateSpy(payload);
                        return { eq: () => Promise.resolve({ error: null }) };
                    },
                };
            }
            if (table === 'vessels') {
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: () =>
                                Promise.resolve({ data: mockVessel, error: null }),
                        }),
                    }),
                };
            }
            if (table === 'shipowners') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: () =>
                                Promise.resolve({
                                    data: mockShipowner,
                                    error: null,
                                }),
                        }),
                    }),
                    update: (payload: Record<string, unknown>) => {
                        shipownerUpdateSpy(payload);
                        return { eq: () => Promise.resolve({ error: null }) };
                    },
                };
            }
            if (table === 'audit_logs') {
                return { insert: auditInsertSpy };
            }
            throw new Error(`unexpected table on admin client: ${table}`);
        },
    }),
}));

const { applyEquasisProposal } = await import('./applyEquasisProposal');

beforeEach(() => {
    upsertEmailSpy.mockClear();
    getOrCreateGhostSpy.mockClear();
    proposalUpdateSpy.mockClear();
    shipownerUpdateSpy.mockClear();
    auditInsertSpy.mockClear();
    callerProfile = { role: 'PORT_OFFICER', full_name: 'Officer A' };
    callerUser = { id: 'officer-uuid' };
    mockProposal = {
        id: 'proposal-uuid',
        imo_number: '9876543',
        shipowner_id: 'owner-uuid',
        proposed_owner_name: 'Acme Maritime Ltd',
        proposed_manager: null,
        proposed_email: 'ops@acme.com',
        proposed_country: 'PA',
        applied: false,
        reviewed_at: null,
    };
    mockVessel = { shipowner_id: 'owner-uuid' };
    mockShipowner = { name: null, country_code: null, official_email_source: null };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sk_test';
});

describe('applyEquasisProposal', () => {
    const validInput = { proposalId: 'a1b2c3d4-e5f6-4789-9abc-def012345678' };

    it('rejects unauthenticated callers', async () => {
        callerUser = null;
        const r = await applyEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not authenticated/i);
    });

    it('rejects FINANCE_ADMIN', async () => {
        callerProfile = { role: 'FINANCE_ADMIN', full_name: 'X' };
        const r = await applyEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/insufficient role/i);
    });

    it('refuses an already-applied proposal', async () => {
        mockProposal = { ...mockProposal!, applied: true };
        const r = await applyEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/already applied/i);
        expect(upsertEmailSpy).not.toHaveBeenCalled();
    });

    it('refuses an already-rejected proposal', async () => {
        mockProposal = { ...mockProposal!, reviewed_at: '2026-04-26T00:00:00Z' };
        const r = await applyEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/already rejected/i);
    });

    it('happy path: applies email through trust chain + fills name + country', async () => {
        const r = await applyEquasisProposal(validInput);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.shipownerId).toBe('owner-uuid');

        // Email applied via trust chain helper
        expect(upsertEmailSpy).toHaveBeenCalledTimes(1);
        const [, ownerId, email, source] = upsertEmailSpy.mock.calls[0]!;
        expect(ownerId).toBe('owner-uuid');
        expect(email).toBe('ops@acme.com');
        expect(source).toBe('EQUASIS_VERIFIED');

        // Name + country filled (both were null)
        const fillPayload = shipownerUpdateSpy.mock.calls[0]![0] as Record<string, string>;
        expect(fillPayload).toMatchObject({
            name: 'Acme Maritime Ltd',
            country_code: 'PA',
        });

        // Proposal stamped
        const propPayload = proposalUpdateSpy.mock.calls[0]![0];
        expect(propPayload).toMatchObject({
            applied: true,
            shipowner_id: 'owner-uuid',
            reviewed_by: 'officer-uuid',
        });

        expect(auditInsertSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT clobber an officer-set name', async () => {
        mockShipowner = {
            name: 'Officer-set name',
            country_code: 'SO',
            official_email_source: 'PORT_OFFICER',
        };
        await applyEquasisProposal(validInput);
        // name update should not appear in the fill payload
        const fillCalls = shipownerUpdateSpy.mock.calls;
        if (fillCalls.length > 0) {
            const payload = fillCalls[0]![0] as Record<string, string>;
            expect(payload.name).toBeUndefined();
            expect(payload.country_code).toBeUndefined();
        }
    });

    it('overwrites placeholder GHOST name "Owner of IMO …"', async () => {
        mockShipowner = {
            name: 'Owner of IMO 9876543',
            country_code: null,
            official_email_source: null,
        };
        await applyEquasisProposal(validInput);
        const fillPayload = shipownerUpdateSpy.mock.calls[0]![0] as Record<string, string>;
        expect(fillPayload.name).toBe('Acme Maritime Ltd');
    });

    it('falls back to GHOST creation when no shipowner can be resolved', async () => {
        mockProposal = { ...mockProposal!, shipowner_id: null };
        mockVessel = null; // no vessel either
        const r = await applyEquasisProposal(validInput);
        expect(r.ok).toBe(true);
        expect(getOrCreateGhostSpy).toHaveBeenCalledTimes(1);
        if (r.ok) expect(r.shipownerId).toBe('ghost-uuid');
    });

    it('skips email step when proposal has no email', async () => {
        mockProposal = { ...mockProposal!, proposed_email: null };
        const r = await applyEquasisProposal(validInput);
        expect(r.ok).toBe(true);
        expect(upsertEmailSpy).not.toHaveBeenCalled();
        // Name + country still filled
        const fillPayload = shipownerUpdateSpy.mock.calls[0]![0] as Record<string, string>;
        expect(fillPayload.name).toBe('Acme Maritime Ltd');
    });
});
