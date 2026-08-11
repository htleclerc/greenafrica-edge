import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockFrom, mockAdminFrom, mockUpsertEmail } = vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockFrom: vi.fn(),
    mockAdminFrom: vi.fn(),
    mockUpsertEmail: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: mockAuth }, from: mockFrom }),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: mockAdminFrom }),
}));
vi.mock('@/services/shipownerService', () => ({
    upsertShipownerEmail: mockUpsertEmail,
}));

import { applyVesselIdentity } from './applyVesselIdentity';

/**
 * Construit un faux client dont chaque table renvoie une réponse scriptée.
 *
 * `vessels` est interrogée deux fois avec des filtres différents : une fois
 * pour charger le navire cible (`.eq('id', vesselId)`), une fois pour
 * détecter une collision d'identité en excluant ce même navire
 * (`.neq('id', vessel.id)`). Une réponse scriptée statique par table ne peut
 * pas distinguer les deux appels — sans le filtrage ci-dessous, la ligne
 * `vessels` scriptée se retrouverait aussi comme "collision" avec elle-même
 * à chaque appariement réussi. `neq('id', …)` exclut donc la ligne dont l'id
 * correspond, comme le ferait Postgres.
 */
function tableStub(responses: Record<string, unknown>) {
    return (table: string) => {
        const row = responses[table] as { id?: unknown } | null | undefined;
        let excluded = false;
        const chain = {
            select: () => chain,
            eq: () => chain,
            neq: (column: string, value: unknown) => {
                if (row && column === 'id' && row.id === value) excluded = true;
                return chain;
            },
            or: () => chain,
            maybeSingle: async () => ({ data: excluded ? null : (row ?? null), error: null }),
            single: async () => ({ data: excluded ? null : (row ?? null), error: null }),
            update: () => chain,
            insert: async () => ({ error: null }),
        };
        return chain;
    };
}

const CANDIDATE = {
    id: '11111111-1111-1111-1111-111111111111',
    imo_number: '7504158', mmsi: '671882000', call_sign: '5VEV4', vessel_name: 'TRUST 1',
    flag_code: 'TG', category: 'CARGO', type_raw: 'Livestock Carrier',
    gross_tonnage: 2975, deadweight: 2560, build_year: 1975,
    manager_email: 'faros@farosshipping.example', owner_email: null, ism_manager_email: null,
    contact_blocked: false, contact_blocked_reason: null, status: 'PENDING',
};

const PLACEHOLDER_VESSEL = {
    id: '22222222-2222-2222-2222-222222222222',
    imo_number: 'UNVERIFIED-nav-042', mmsi: null, shipowner_id: '33333333-3333-3333-3333-333333333333',
    jurisdiction_id: null,
};

const INPUT = { candidateId: CANDIDATE.id, vesselId: PLACEHOLDER_VESSEL.id };

beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockImplementation(tableStub({ profiles: { role: 'PORT_OFFICER', full_name: 'Officier' } }));
    mockUpsertEmail.mockResolvedValue({});
});

describe('applyVesselIdentity', () => {
    it('refuse un utilisateur non authentifié', async () => {
        mockAuth.mockResolvedValue({ data: { user: null } });
        expect(await applyVesselIdentity(INPUT)).toEqual({ ok: false, reason: 'not authenticated' });
    });

    it('refuse un rôle insuffisant', async () => {
        mockFrom.mockImplementation(tableStub({ profiles: { role: 'SHIPPING_AGENT', full_name: 'Agent' } }));
        expect(await applyVesselIdentity(INPUT)).toEqual({ ok: false, reason: 'insufficient role' });
    });

    it('refuse d’écrire sur un navire déjà identifié', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: CANDIDATE,
            vessels: { ...PLACEHOLDER_VESSEL, imo_number: '9235957' },
        }));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toEqual({ ok: false, reason: 'vessel already identified' });
        expect(mockUpsertEmail).not.toHaveBeenCalled();
    });

    it('accepte les trois formes de non-identité', async () => {
        for (const imo of ['UNVERIFIED-nav-042', 'à confirmer', 'Hors registre Equasis']) {
            mockAdminFrom.mockImplementation(tableStub({
                vessel_identity_candidates: CANDIDATE,
                vessels: { ...PLACEHOLDER_VESSEL, imo_number: imo },
            }));
            const r = await applyVesselIdentity(INPUT);
            expect(r.ok, `imo=${imo}`).toBe(true);
        }
    });

    it('applique l’e-mail du manager via VESSELFINDER_VERIFIED', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: CANDIDATE,
            vessels: PLACEHOLDER_VESSEL,
        }));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toMatchObject({ ok: true, emailApplied: true });
        expect(mockUpsertEmail).toHaveBeenCalledWith(
            expect.anything(), PLACEHOLDER_VESSEL.shipowner_id,
            'faros@farosshipping.example', 'VESSELFINDER_VERIFIED',
        );
    });

    it('n’applique jamais l’e-mail d’un contact bloqué', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: {
                ...CANDIDATE, contact_blocked: true,
                contact_blocked_reason: 'ISM manager sous sanctions : Morgan Navigation SA (arm-013)',
                manager_email: null, ism_manager_email: 'morgan.navigation@mail.example',
            },
            vessels: PLACEHOLDER_VESSEL,
        }));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toMatchObject({ ok: true, emailApplied: false });
        expect(mockUpsertEmail).not.toHaveBeenCalled();
    });

    it('refuse un candidat déjà traité', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: { ...CANDIDATE, status: 'MATCHED' },
            vessels: PLACEHOLDER_VESSEL,
        }));
        expect(await applyVesselIdentity(INPUT)).toEqual({ ok: false, reason: 'candidate already processed' });
    });

    it('refuse une entrée mal formée', async () => {
        const r = await applyVesselIdentity({ candidateId: 'pas-un-uuid', vesselId: 'non plus' });
        expect(r.ok).toBe(false);
    });
});
