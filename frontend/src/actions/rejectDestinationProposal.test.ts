import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseMock = { auth: { getUser: vi.fn() }, from: vi.fn() };
const adminMock = { from: vi.fn() };

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => supabaseMock),
}));
vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => adminMock),
}));

import { rejectDestinationProposal } from './rejectDestinationProposal';

describe('rejectDestinationProposal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv-test';
        supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    });

    it('rejects insufficient role', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: { role: 'SHIPPING_AGENT' } }),
                }),
            }),
        });
        const r = await rejectDestinationProposal({
            proposalId: '11111111-1111-4111-8111-111111111111',
            note: 'wrong port',
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
                                data: { id: 'p1', status: 'APPROVED' },
                            }),
                        }),
                    }),
                };
            }
            return {};
        });
        const r = await rejectDestinationProposal({
            proposalId: '11111111-1111-4111-8111-111111111111',
            note: 'wrong port',
        });
        expect(r).toEqual({ ok: false, reason: 'proposal not pending' });
    });

    it('happy path: marks REJECTED with note', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({ single: async () => ({ data: { role: 'PORT_OFFICER' } }) }),
            }),
        });
        let updated = false;
        adminMock.from.mockImplementation((table: string) => {
            if (table === 'destination_match_proposals') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({ data: { id: 'p1', status: 'PENDING' } }),
                        }),
                    }),
                    update: () => ({
                        eq: async () => {
                            updated = true;
                            return { error: null };
                        },
                    }),
                };
            }
            return {};
        });
        const r = await rejectDestinationProposal({
            proposalId: '11111111-1111-4111-8111-111111111111',
            note: 'wrong port',
        });
        expect(r.ok).toBe(true);
        expect(updated).toBe(true);
    });
});
