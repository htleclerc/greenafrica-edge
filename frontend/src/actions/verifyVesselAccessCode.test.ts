import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerifyOtp, mockAdminFrom, mockAudit, mockUpdate } = vi.hoisted(() => ({
    mockVerifyOtp: vi.fn(),
    mockAdminFrom: vi.fn(),
    mockAudit: vi.fn(),
    mockUpdate: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { verifyOtp: mockVerifyOtp } }),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: mockAdminFrom }),
}));
vi.mock('@/services/auditService', () => ({ writeAuditLog: mockAudit }));

import { verifyVesselAccessCode } from './verifyVesselAccessCode';

let ownerFixture = {
    id: 'owner-1',
    official_email: 'contact@hornshipping.com',
    official_email_source: 'EQUASIS_VERIFIED',
    is_placeholder: false,
    account_state: 'GHOST',
    profile_id: null as string | null,
    jurisdiction_id: 'jur-1',
};

beforeEach(() => {
    vi.clearAllMocks();
    ownerFixture = { ...ownerFixture, official_email_source: 'EQUASIS_VERIFIED', profile_id: null };
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-9' } }, error: null });
    mockUpdate.mockResolvedValue({ error: null });
    mockAdminFrom.mockImplementation((table: string) => {
        if (table === 'transactions') {
            return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => ({
                maybeSingle: async () => ({ data: { shipowner_id: 'owner-1' }, error: null }),
            }) }) }) }) }) };
        }
        return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ownerFixture, error: null }) }) }),
            update: (patch: Record<string, unknown>) => {
                mockUpdate(patch);
                return { eq: async () => ({ error: null }) };
            },
        };
    });
});

describe('verifyVesselAccessCode', () => {
    it('active le compte et redirige vers le portail', async () => {
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(r).toEqual({ ok: true, redirectTo: '/dashboard' });
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            account_state: 'ACTIVE',
            profile_id: 'user-9',
        }));
    });

    it("horodate la vérification de l'adresse", async () => {
        await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(mockUpdate.mock.calls[0][0]).toHaveProperty('email_verified_at');
    });

    it("écrit une ligne d'audit en WARNING quand la source est AGENT_CLAIM", async () => {
        ownerFixture = { ...ownerFixture, official_email_source: 'AGENT_CLAIM' };
        await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(mockAudit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ severity: 'WARNING' }),
        );
    });

    it('écrit une ligne d\'audit en INFO pour les sources vérifiées', async () => {
        await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(mockAudit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ severity: 'INFO' }),
        );
    });

    it('refuse un code invalide sans rien activer', async () => {
        mockVerifyOtp.mockResolvedValue({ data: null, error: { message: 'invalid token' } });
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '000000' });
        expect(r).toEqual({ ok: false, reason: 'invalid_code' });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('G2 — refuse un armateur de regroupement même avec un code valide', async () => {
        ownerFixture = { ...ownerFixture, is_placeholder: true };
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(r).toEqual({ ok: false, reason: 'not_claimable' });
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});
