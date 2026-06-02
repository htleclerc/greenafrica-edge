import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockServer = { auth: { getUser: vi.fn() }, from: vi.fn() };
const mockPlatform = { from: vi.fn() };
const mockTenant = { from: vi.fn() };

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => mockServer) }));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockPlatform),
    createTenantClient: vi.fn(() => mockTenant),
}));
vi.mock('@/lib/auth/tenantContext', () => ({
    getServerJurisdictionId: vi.fn(async () => 'jur-1'),
}));

function selectSingle(value: unknown) {
    return { select: () => ({ eq: () => ({ single: async () => ({ data: value, error: null }) }) }) };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });
});

describe('setOperatorAocNumber', () => {
    it('rejects a non-admin role', async () => {
        mockServer.from.mockReturnValue(selectSingle({ role: 'SHIPOWNER' }));
        const { setOperatorAocNumber } = await import('./setOperatorAocNumber');
        const r = await setOperatorAocNumber({ operatorId: '00000000-0000-4000-8000-000000000001', aocNumber: 'AOC123' });
        expect(r.ok).toBe(false);
    });

    it('SUPERADMIN sets aoc_number (uppercased)', async () => {
        mockServer.from.mockReturnValue(selectSingle({ role: 'SUPERADMIN' }));
        mockPlatform.from.mockReturnValue(selectSingle({ id: 'op-1', jurisdiction_id: 'jur-1' }));
        let written: string | undefined;
        mockTenant.from.mockReturnValue({
            update: (patch: { aoc_number: string }) => ({ eq: async () => { written = patch.aoc_number; return { error: null }; } }),
        });
        const { setOperatorAocNumber } = await import('./setOperatorAocNumber');
        const r = await setOperatorAocNumber({ operatorId: '00000000-0000-4000-8000-000000000001', aocNumber: 'aoc-9z' });
        expect(r.ok).toBe(true);
        expect(written).toBe('AOC-9Z');
    });

    it('blocks a non-SUPERADMIN from another jurisdiction', async () => {
        mockServer.from.mockReturnValue(selectSingle({ role: 'MANAGER' }));
        mockPlatform.from.mockReturnValue(selectSingle({ id: 'op-1', jurisdiction_id: 'jur-OTHER' }));
        const { setOperatorAocNumber } = await import('./setOperatorAocNumber');
        const r = await setOperatorAocNumber({ operatorId: '00000000-0000-4000-8000-000000000001', aocNumber: 'AOC1' });
        expect(r.ok).toBe(false);
    });
});
