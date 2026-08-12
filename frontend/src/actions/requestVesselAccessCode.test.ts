import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminFrom, mockSignInWithOtp, mockEnforce } = vi.hoisted(() => ({
    mockAdminFrom: vi.fn(),
    mockSignInWithOtp: vi.fn(),
    mockEnforce: vi.fn(),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: mockAdminFrom,
        auth: { signInWithOtp: mockSignInWithOtp },
    }),
}));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: mockEnforce,
    getClientId: () => 'test-client',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { requestVesselAccessCode } from './requestVesselAccessCode';

/** Chaîne de résolution : transactions → shipowners. */
function ownerRow(over: Record<string, unknown> = {}) {
    return {
        id: 'owner-1',
        official_email: 'contact@hornshipping.com',
        official_email_source: 'EQUASIS_VERIFIED',
        is_placeholder: false,
        ...over,
    };
}

let ownerFixture = ownerRow();

beforeEach(() => {
    vi.clearAllMocks();
    ownerFixture = ownerRow();
    mockEnforce.mockResolvedValue({ allowed: true });
    mockSignInWithOtp.mockResolvedValue({ error: null });
    mockAdminFrom.mockImplementation((table: string) => {
        if (table === 'transactions') {
            return {
                select: () => ({
                    eq: () => ({
                        in: () => ({
                            order: () => ({
                                limit: () => ({
                                    maybeSingle: async () => ({
                                        data: { shipowner_id: 'owner-1' },
                                        error: null,
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            };
        }
        if (table === 'vessels') {
            return {
                select: () => ({
                    eq: () => ({ maybeSingle: async () => ({ data: { imo_number: '9424223' }, error: null }) }),
                }),
            };
        }
        // shipowners
        return {
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({ data: ownerFixture, error: null }),
                }),
            }),
        };
    });
});

describe('requestVesselAccessCode', () => {
    it("envoie le code à l'adresse enregistrée et retourne un indice masqué", async () => {
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: true, emailHint: 'c••••t@h••••g.com' });
        expect(mockSignInWithOtp).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'contact@hornshipping.com' }),
        );
    });

    it("ouvre l'accès direct pour AGENT_CLAIM (décision PO 2026-08-12)", async () => {
        ownerFixture = ownerRow({ official_email_source: 'AGENT_CLAIM' });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r.ok).toBe(true);
    });

    it("G2 — n'envoie jamais de code pour un armateur de regroupement", async () => {
        ownerFixture = ownerRow({ is_placeholder: true });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: false, reason: 'not_claimable' });
        expect(mockSignInWithOtp).not.toHaveBeenCalled();
    });

    it("refuse un payload portant une adresse fournie par l'appelant (G4)", async () => {
        const r = await requestVesselAccessCode({
            identifier: '9424223',
            email: 'attaquant@example.com',
        });
        expect(r).toEqual({ ok: false, reason: 'invalid_identifier' });
        expect(mockSignInWithOtp).not.toHaveBeenCalled();
    });

    it("G3 — refuse au-delà du plafond par armateur, même quand l'IP passe", async () => {
        // Premier appel : quota IP OK, quota armateur OK.
        // Second : le quota IP passe encore, mais celui de l'armateur est épuisé.
        mockEnforce
            .mockResolvedValueOnce({ allowed: true })   // IP
            .mockResolvedValueOnce({ allowed: true })   // armateur
            .mockResolvedValueOnce({ allowed: true })   // IP
            .mockResolvedValueOnce({ allowed: false, reason: 'rate_limited_per_hour' }); // armateur

        expect((await requestVesselAccessCode({ identifier: '9424223' })).ok).toBe(true);
        const second = await requestVesselAccessCode({ identifier: '9424223' });
        expect(second).toEqual({ ok: false, reason: 'rate_limited' });
        expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);

        // Les deux plafonds ne doivent pas pouvoir entrer en collision : le
        // premier appel est keyé sur l'IP, le second sur l'armateur. Sans
        // cette distinction, faire varier l'IP suffirait à contourner le
        // second plafond — c'est exactement la faille que G3 doit fermer.
        expect(mockEnforce).toHaveBeenNthCalledWith(1, 'vessel-claim', 'test-client');
        expect(mockEnforce).toHaveBeenNthCalledWith(2, 'vessel-claim', 'owner:owner-1');
        expect(mockEnforce).toHaveBeenNthCalledWith(3, 'vessel-claim', 'test-client');
        expect(mockEnforce).toHaveBeenNthCalledWith(4, 'vessel-claim', 'owner:owner-1');
    });

    it('refuse un identifiant invalide sans toucher la base', async () => {
        const r = await requestVesselAccessCode({ identifier: '123' });
        expect(r).toEqual({ ok: false, reason: 'invalid_identifier' });
        expect(mockAdminFrom).not.toHaveBeenCalled();
    });

    it("remonte send_failed quand Supabase refuse l'envoi", async () => {
        mockSignInWithOtp.mockResolvedValue({ error: { message: 'smtp down' } });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: false, reason: 'send_failed' });
    });

    it("résout un MMSI en IMO avant de chercher l'avis", async () => {
        const r = await requestVesselAccessCode({ identifier: '341581000' });
        expect(r.ok).toBe(true);
    });
});
