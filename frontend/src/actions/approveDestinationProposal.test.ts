import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseMock = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
};
const adminMock = { from: vi.fn() };

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => supabaseMock),
}));
vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => adminMock),
}));

import { approveDestinationProposal } from './approveDestinationProposal';

describe('approveDestinationProposal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv-test';
        supabaseMock.auth.getUser.mockResolvedValue({
            data: { user: { id: 'u1' } },
        });
    });

    it('rejects unauthenticated callers', async () => {
        supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } });
        const r = await approveDestinationProposal({
            proposalId: '11111111-1111-4111-8111-111111111111',
            port: 'BERBERA',
            addToAllowList: true,
            createAlert: false,
        });
        expect(r).toEqual({ ok: false, reason: 'not authenticated' });
    });

    it('rejects callers without SUPERADMIN/PORT_OFFICER role', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({
                    single: async () => ({
                        data: { role: 'SHIPPING_AGENT', full_name: 'A' },
                    }),
                }),
            }),
        });
        const r = await approveDestinationProposal({
            proposalId: '11111111-1111-4111-8111-111111111111',
            port: 'BERBERA',
            addToAllowList: true,
            createAlert: false,
        });
        expect(r).toEqual({ ok: false, reason: 'insufficient role' });
    });

    it('rejects non-PENDING proposals', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: { role: 'PORT_OFFICER' } }),
                }),
            }),
        });
        adminMock.from.mockImplementation((table: string) => {
            if (table === 'destination_match_proposals') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: { id: 'p1', status: 'APPROVED', normalized: 'BBR', mmsi: 'M' },
                            }),
                        }),
                    }),
                };
            }
            return {};
        });
        const r = await approveDestinationProposal({
            proposalId: '11111111-1111-4111-8111-111111111111',
            port: 'BERBERA',
            addToAllowList: true,
            createAlert: false,
        });
        expect(r).toEqual({ ok: false, reason: 'proposal not pending' });
    });

    it('happy path: updates proposal + merges allow-list (idempotent)', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: { role: 'PORT_OFFICER' } }),
                }),
            }),
        });
        let updateCalled = false;
        let configRead = false;
        let configUpdated = false;
        adminMock.from.mockImplementation((table: string) => {
            if (table === 'destination_match_proposals') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: {
                                    id: 'p1',
                                    status: 'PENDING',
                                    normalized: 'NEWVAR',
                                    mmsi: 'M',
                                    matched_port_guess: 'BERBERA',
                                },
                            }),
                        }),
                    }),
                    update: () => ({
                        eq: async () => {
                            updateCalled = true;
                            return { error: null };
                        },
                    }),
                };
            }
            if (table === 'app_config') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => {
                                configRead = true;
                                return {
                                    data: {
                                        value: { BERBERA: ['BERBERA', 'BBR'], ZEILA: ['ZEILA'] },
                                    },
                                };
                            },
                        }),
                    }),
                    update: () => ({
                        eq: async () => {
                            configUpdated = true;
                            return { error: null };
                        },
                    }),
                };
            }
            return {};
        });
        const r = await approveDestinationProposal({
            proposalId: '11111111-1111-4111-8111-111111111111',
            port: 'BERBERA',
            addToAllowList: true,
            createAlert: false,
        });
        expect(r.ok).toBe(true);
        expect(updateCalled).toBe(true);
        expect(configRead).toBe(true);
        expect(configUpdated).toBe(true);
    });
});
