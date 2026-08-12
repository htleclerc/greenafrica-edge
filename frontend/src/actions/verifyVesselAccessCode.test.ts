import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerifyOtp, mockAdminFrom, mockAudit, mockUpdate, mockEnforce } = vi.hoisted(() => ({
    mockVerifyOtp: vi.fn(),
    mockAdminFrom: vi.fn(),
    mockAudit: vi.fn(),
    mockUpdate: vi.fn(),
    mockEnforce: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { verifyOtp: mockVerifyOtp } }),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: mockAdminFrom }),
}));
vi.mock('@/services/auditService', () => ({ writeAuditLog: mockAudit }));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: mockEnforce,
    getClientId: () => 'test-client',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { verifyVesselAccessCode } from './verifyVesselAccessCode';

/**
 * Fabrique un armateur « propre » à chaque appel — pas un spread depuis l'état
 * mutable d'un test précédent. Sans ça, un test qui met `is_placeholder: true`
 * (ex. G2) fuit silencieusement vers les tests suivants dans l'ordre du
 * fichier, puisque le beforeEach ne réécrivait auparavant que deux champs.
 */
function ownerRow(over: Record<string, unknown> = {}) {
    return {
        id: 'owner-1',
        official_email: 'contact@hornshipping.com',
        official_email_source: 'EQUASIS_VERIFIED',
        is_placeholder: false,
        account_state: 'GHOST',
        profile_id: null as string | null,
        jurisdiction_id: 'jur-1',
        ...over,
    };
}

let ownerFixture = ownerRow();
let profileFixture: { full_name: string | null } | null = { full_name: 'Horn Shipping SA' };

/** null = succès ; non-null = ce que `.eq()` renverra comme erreur d'update. */
let updateEqError: { message: string } | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    ownerFixture = ownerRow();
    profileFixture = { full_name: 'Horn Shipping SA' };
    updateEqError = null;
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-9' } }, error: null });
    mockEnforce.mockResolvedValue({ allowed: true });
    mockAdminFrom.mockImplementation((table: string) => {
        if (table === 'transactions') {
            return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => ({
                maybeSingle: async () => ({ data: { shipowner_id: 'owner-1' }, error: null }),
            }) }) }) }) }) };
        }
        if (table === 'profiles') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileFixture, error: null }) }) }) };
        }
        // shipowners
        return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ownerFixture, error: null }) }) }),
            update: (patch: Record<string, unknown>) => {
                mockUpdate(patch);
                return { eq: async () => ({ error: updateEqError }) };
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
        ownerFixture = ownerRow({ official_email_source: 'AGENT_CLAIM' });
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

    it("écrit une ligne d'audit en WARNING quand la source est absente (NULL)", async () => {
        ownerFixture = ownerRow({ official_email_source: null as unknown as string });
        await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(mockAudit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ severity: 'WARNING' }),
        );
    });

    it("écrit une ligne d'audit dont la forme complète respecte le schéma audit_logs (mig 003)", async () => {
        await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(mockAudit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                user_id: 'user-9',
                user_full_name: 'Horn Shipping SA',
                action: 'SHIPOWNER_SELF_CLAIM',
                entity_type: 'Shipowner',
                entity_id: 'owner-1',
                jurisdiction_id: 'jur-1',
                details_json: expect.objectContaining({
                    vessel_imo: '9424223',
                    email_source: 'EQUASIS_VERIFIED',
                }),
            }),
        );
        // audit_logs (mig 003) n'a pas de colonne `metadata` — un payload qui en
        // porte une échouerait silencieusement (writeAuditLog avale l'erreur).
        const payload = mockAudit.mock.calls[0][1] as Record<string, unknown>;
        expect(payload).not.toHaveProperty('metadata');
    });

    it('utilise un nom par défaut quand le profil vient d\'être créé et n\'est pas encore lisible', async () => {
        profileFixture = null;
        await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(mockAudit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ user_full_name: 'Armateur (auto-rattachement)' }),
        );
    });

    it('refuse un code invalide sans rien activer', async () => {
        mockVerifyOtp.mockResolvedValue({ data: null, error: { message: 'invalid token' } });
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '000000' });
        expect(r).toEqual({ ok: false, reason: 'invalid_code' });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('G2 — refuse un armateur de regroupement même avec un code valide', async () => {
        ownerFixture = ownerRow({ is_placeholder: true });
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(r).toEqual({ ok: false, reason: 'not_claimable' });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('refuse au-delà du plafond, avant toute tentative de vérification du code', async () => {
        mockEnforce.mockResolvedValue({ allowed: false, reason: 'rate_limited_per_minute' });
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(r).toEqual({ ok: false, reason: 'rate_limited' });
        expect(mockVerifyOtp).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("remonte un échec et n'écrit pas l'audit quand l'activation échoue en base", async () => {
        updateEqError = { message: 'connection lost' };
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(r).toEqual({ ok: false, reason: 'activation_failed' });
        expect(mockAudit).not.toHaveBeenCalled();
    });
});
