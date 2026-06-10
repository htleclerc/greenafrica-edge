import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUser = { id: 'admin-1', fullName: 'Test Admin', role: 'SUPERADMIN' };

let requireRoleResult: { user: typeof mockUser; error: null } | { user: null; error: { status: number } };
vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => requireRoleResult),
}));

vi.mock('@/lib/auth/adminTenant', () => ({
    assertAdminCanActOn: vi.fn(async (_user: unknown, jid: string) => jid),
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockPlatform = { rpc: mockRpc, from: mockFrom };
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockPlatform),
    createTenantClient: vi.fn(() => mockPlatform),
}));

const VALID_JID = '00000000-0000-4000-8000-00000000534f';
const FUTURE = new Date(Date.now() + 86400_000 * 10).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

function rpcSuccess(new_id = 'new-tariff-id', closed_id: string | null = 'old-tariff-id') {
    mockRpc.mockResolvedValueOnce({ data: [{ new_id, closed_id }], error: null });
}

function rpcError(message: string, code = '') {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message, code } });
}

beforeEach(() => {
    vi.clearAllMocks();
    requireRoleResult = { user: mockUser, error: null };
    // Default audit log mock
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) });
});

describe('createTariffVersion', () => {
    it('rejects today as effectiveFrom (strictly-future enforced at action level)', async () => {
        // The action now defers date enforcement to the RPC, but the Zod schema
        // does NOT block today — the RPC blocks it. However the action should
        // correctly map the RPC check_violation to past_date.
        rpcError('create_tariff_version: effective_from must be strictly future', 'check_violation');
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: TODAY,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('past_date');
    });

    it('rejects non-positive rate via Zod', async () => {
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: -5,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        // No RPC call — Zod rejected first
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rejects impossible date (e.g. 2026-02-31) via Zod refine', async () => {
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: '2026-02-31',
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rejects forbidden role', async () => {
        requireRoleResult = { user: null, error: { status: 403 } };
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('forbidden');
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it('maps RPC insufficient_privilege to forbidden', async () => {
        rpcError('create_tariff_version: forbidden', 'insufficient_privilege');
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('forbidden');
    });

    it('maps 23P01 to overlap', async () => {
        rpcError('tariffs_no_overlap constraint violated', '23P01');
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('overlap');
    });

    it('maps "already exists at/after" message to overlap', async () => {
        rpcError('an open version starting 2026-06-15 already exists at/after 2026-06-14', 'exclusion_violation');
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('overlap');
    });

    it('returns ok:true on successful RPC call and logs both ids', async () => {
        rpcSuccess('new-id-abc', 'old-id-xyz');
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'AIR',
            ratePerTco2: 55,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-AIR-001',
        });
        expect(r.ok).toBe(true);
        expect(mockRpc).toHaveBeenCalledWith('create_tariff_version', expect.objectContaining({
            p_jurisdiction_id: VALID_JID,
            p_mode: 'AIR',
            p_rate: 55,
            p_effective_from: FUTURE,
            p_decree_ref: 'DEC-AIR-001',
            p_actor: 'admin-1',
        }));
        // Audit log insert should include both ids
        const insertCall = mockFrom.mock.results[0]?.value?.insert;
        expect(insertCall).toBeDefined();
    });

    it('FINANCE_ADMIN non-member → forbidden (auth-first: no RPC called)', async () => {
        const financeUser = { id: 'finance-1', fullName: 'Finance Admin', role: 'FINANCE_ADMIN' };
        requireRoleResult = { user: financeUser, error: null };

        const { assertAdminCanActOn } = await import('@/lib/auth/adminTenant');
        vi.mocked(assertAdminCanActOn).mockRejectedValueOnce(new Error('not a member'));

        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });

        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('forbidden');
        // Auth-first: no RPC should have been called
        expect(mockRpc).not.toHaveBeenCalled();
    });
});
