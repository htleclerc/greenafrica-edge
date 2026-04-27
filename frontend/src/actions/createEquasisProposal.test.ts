import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertSpy = vi.fn((_p: Record<string, unknown>) => ({
    select: () => ({
        single: () =>
            Promise.resolve({ data: { id: 'proposal-uuid' }, error: null }),
    }),
}));

let callerProfile: { role: string } | null = { role: 'PORT_OFFICER' };
let callerUser: { id: string } | null = { id: 'officer-uuid' };
let mockVessel: { shipowner_id: string | null } | null = {
    shipowner_id: 'owner-uuid',
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
            if (table === 'equasis_scrape_proposals') {
                return { insert: insertSpy };
            }
            throw new Error(`unexpected table on admin client: ${table}`);
        },
    }),
}));

const { createEquasisProposal } = await import('./createEquasisProposal');

beforeEach(() => {
    insertSpy.mockClear();
    callerProfile = { role: 'PORT_OFFICER' };
    callerUser = { id: 'officer-uuid' };
    mockVessel = { shipowner_id: 'owner-uuid' };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sk_test';
});

describe('createEquasisProposal', () => {
    const validInput = {
        imoNumber: '9876543',
        proposedOwnerName: 'Acme Maritime Ltd',
        proposedEmail: 'ops@acme-maritime.com',
        proposedCountry: 'PA',
    };

    it('rejects unauthenticated callers', async () => {
        callerUser = null;
        const r = await createEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not authenticated/i);
    });

    it('rejects FINANCE_ADMIN (not in allow-list)', async () => {
        callerProfile = { role: 'FINANCE_ADMIN' };
        const r = await createEquasisProposal(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/insufficient role/i);
    });

    it('allows MANAGER', async () => {
        callerProfile = { role: 'MANAGER' };
        const r = await createEquasisProposal(validInput);
        expect(r.ok).toBe(true);
    });

    it('refuses empty proposals (no owner/manager/email/country)', async () => {
        const r = await createEquasisProposal({ imoNumber: '9876543' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/at least one of/i);
        expect(insertSpy).not.toHaveBeenCalled();
    });

    it('rejects malformed email', async () => {
        const r = await createEquasisProposal({
            ...validInput,
            proposedEmail: 'not-an-email',
        });
        expect(r.ok).toBe(false);
    });

    it('happy path resolves shipowner_id from vessel + tags source=manual', async () => {
        const r = await createEquasisProposal(validInput);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.proposalId).toBe('proposal-uuid');

        const payload = insertSpy.mock.calls[0]![0];
        expect(payload).toMatchObject({
            imo_number: '9876543',
            shipowner_id: 'owner-uuid',
            proposed_owner_name: 'Acme Maritime Ltd',
            proposed_email: 'ops@acme-maritime.com',
            proposed_country: 'PA',
            source: 'manual',
        });
    });

    it('handles vessel-not-found by setting shipowner_id null', async () => {
        mockVessel = null;
        await createEquasisProposal(validInput);
        const payload = insertSpy.mock.calls[0]![0];
        expect(payload).toMatchObject({
            imo_number: '9876543',
            shipowner_id: null,
            source: 'manual',
        });
    });

    it('handles vessel-without-owner by setting shipowner_id null', async () => {
        mockVessel = { shipowner_id: null };
        await createEquasisProposal(validInput);
        const payload = insertSpy.mock.calls[0]![0];
        expect(payload).toMatchObject({ shipowner_id: null });
    });
});
