import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateSpy = vi.fn((_p: Record<string, unknown>) => ({
    eq: () => Promise.resolve({ error: null }),
}));

let callerProfile: { role: string } | null = { role: 'PORT_OFFICER' };
let callerUser: { id: string } | null = { id: 'officer-uuid' };
let mockProposal: {
    id: string;
    applied: boolean;
    reviewed_at: string | null;
} | null = {
    id: 'proposal-uuid',
    applied: false,
    reviewed_at: null,
};

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
                        updateSpy(payload);
                        return { eq: () => Promise.resolve({ error: null }) };
                    },
                };
            }
            throw new Error(`unexpected table: ${table}`);
        },
    }),
}));

const { rejectEquasisProposal } = await import('./rejectEquasisProposal');

beforeEach(() => {
    updateSpy.mockClear();
    callerProfile = { role: 'PORT_OFFICER' };
    callerUser = { id: 'officer-uuid' };
    mockProposal = { id: 'proposal-uuid', applied: false, reviewed_at: null };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sk_test';
});

describe('rejectEquasisProposal', () => {
    const validInput = {
        proposalId: 'a1b2c3d4-e5f6-4789-9abc-def012345678',
        reason: 'Owner email not visible in Equasis page — needs manual lookup',
    };

    it('rejects unauthenticated callers', async () => {
        callerUser = null;
        const r = await rejectEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not authenticated/i);
    });

    it('rejects SHIPPING_AGENT (not in allow-list)', async () => {
        callerProfile = { role: 'SHIPPING_AGENT' };
        const r = await rejectEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/insufficient role/i);
    });

    it('rejects reason shorter than 3 chars', async () => {
        const r = await rejectEquasisProposal({ ...validInput, reason: 'no' });
        expect(r.ok).toBe(false);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('refuses to reject an already-applied proposal', async () => {
        mockProposal = { ...mockProposal!, applied: true, reviewed_at: '2026-04-26T00:00:00Z' };
        const r = await rejectEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/already applied/i);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('refuses to reject an already-rejected proposal', async () => {
        mockProposal = { ...mockProposal!, reviewed_at: '2026-04-26T00:00:00Z' };
        const r = await rejectEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/already rejected/i);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('happy path stamps reviewed_by/at + rejected_reason, applied=false', async () => {
        const r = await rejectEquasisProposal(validInput);
        expect(r.ok).toBe(true);

        const payload = updateSpy.mock.calls[0]![0];
        expect(payload).toMatchObject({
            applied: false,
            reviewed_by: 'officer-uuid',
            rejected_reason: validInput.reason,
        });
        expect(payload.reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
