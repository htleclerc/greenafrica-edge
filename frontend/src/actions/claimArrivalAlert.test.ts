import { describe, it, expect, vi, beforeEach } from 'vitest';

const authUser = { id: 'agent-1' };

// vi.mock factories are hoisted above module-level const declarations, so the
// mock fns they close over must themselves be created via vi.hoisted().
const { getUserMock, serverFromMock, platformFromMock, tenantClientMock, tenantFromMock } = vi.hoisted(() => ({
    getUserMock: vi.fn(),
    serverFromMock: vi.fn(),
    platformFromMock: vi.fn(),
    tenantClientMock: vi.fn(),
    tenantFromMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: getUserMock }, from: serverFromMock }),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: platformFromMock }),
    createTenantClient: tenantClientMock,
}));

import { claimArrivalAlert } from './claimArrivalAlert';

// Helpers pour scripter les tables du client platform / tenant.
function platformTables(tables: Record<string, unknown>) {
    platformFromMock.mockImplementation((t: string) => tables[t]);
}

const okInput = { alertId: '11111111-1111-4111-8111-111111111111', ownerEmail: 'owner@example.com' };

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: authUser } });
    serverFromMock.mockImplementation((t: string) => {
        if (t === 'profiles') {
            return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'SHIPPING_AGENT' } }) }) }) };
        }
        throw new Error(`unexpected server table ${t}`);
    });
    tenantClientMock.mockImplementation(() => ({ from: tenantFromMock }));
});

describe('claimArrivalAlert', () => {
    it('validates owner email is present', async () => {
        const result = await claimArrivalAlert({ alertId: 'x', ownerEmail: '' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toMatch(/email|invalid/i);
        }
    });

    it('scopes the claim to the alert jurisdiction once the agent is a member', async () => {
        platformTables({
            arrival_alerts: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-1' } }) }) }) },
            user_jurisdictions: { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: 'agent-1' } }) }) }) }) },
        });
        // Short-circuit the claim UPDATE itself so the test only exercises client
        // acquisition, not the rest of the claim/ghost/email flow.
        tenantFromMock.mockImplementation((t: string) => {
            if (t === 'arrival_alerts') {
                return {
                    update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
                };
            }
            throw new Error(`unexpected tenant table ${t}`);
        });

        const result = await claimArrivalAlert(okInput);

        expect(tenantClientMock).toHaveBeenCalledWith('jur-1');
        expect(result).toMatchObject({ ok: false, reason: 'alert not found or already claimed' });
    });

    it('rejects an agent who is not a member of the alert jurisdiction', async () => {
        platformTables({
            arrival_alerts: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-1' } }) }) }) },
            user_jurisdictions: { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
        });

        const result = await claimArrivalAlert(okInput);

        expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/not found/i) });
        expect(tenantClientMock).not.toHaveBeenCalled();
    });

    // Deeper integration tests live in arrivalAlertService.test.ts
    // (claim logic is exercised there with a real DB).
});
