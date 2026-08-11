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

/** Ligne de navire tierce utilisée uniquement pour les tests de collision (garde 4). */
interface OtherVesselRow {
    id: string;
    imo_number: string | null;
    mmsi: string | null;
}

/**
 * Construit un faux client dont chaque table renvoie une réponse scriptée.
 *
 * `vessels` est interrogée jusqu'à trois fois avec des filtres différents :
 * une fois pour charger le navire cible (`.eq('id', vesselId)`), puis une ou
 * deux fois pour détecter une collision d'identité en excluant ce même
 * navire (`.neq('id', vessel.id).eq('imo_number', …)` puis, si besoin,
 * `.eq('mmsi', …)`). Une réponse scriptée statique par table ne peut pas
 * distinguer ces appels — sans le filtrage ci-dessous, la ligne `vessels`
 * scriptée se retrouverait comme "collision" avec elle-même à chaque
 * appariement réussi.
 *
 * `vesselCollisions`, quand fourni, simule une vraie recherche filtrée par
 * colonne (`imo_number` ou `mmsi`) parmi une liste de navires tiers — c'est
 * ce qui permet de vérifier que la garde 4 interroge bien la valeur exacte
 * de `candidate.mmsi` via `.eq()` plutôt que de la concaténer dans une
 * chaîne `.or()` où une virgule pourrait la détourner.
 */
function tableStub(
    responses: Record<string, unknown>,
    options?: { vesselCollisions?: OtherVesselRow[] },
) {
    return (table: string) => {
        const row = responses[table] as { id?: unknown } | null | undefined;
        const collisions = table === 'vessels' ? options?.vesselCollisions : undefined;
        const filters: Record<string, unknown> = {};
        let excludedId: unknown;
        const chain = {
            select: () => chain,
            eq: (column: string, value: unknown) => {
                filters[column] = value;
                return chain;
            },
            neq: (column: string, value: unknown) => {
                if (column === 'id') excludedId = value;
                return chain;
            },
            or: () => chain,
            maybeSingle: async () => {
                // Chargement par id (garde 3) : jamais combiné à un .neq() ici.
                if ('id' in filters && excludedId === undefined) {
                    return { data: row ?? null, error: null };
                }
                // Recherche de collision (garde 4), simulée par colonne filtrée.
                if (collisions) {
                    const match = collisions.find((v) => {
                        if (excludedId !== undefined && v.id === excludedId) return false;
                        if ('imo_number' in filters) return v.imo_number === filters.imo_number;
                        if ('mmsi' in filters) return v.mmsi === filters.mmsi;
                        return false;
                    });
                    return { data: match ?? null, error: null };
                }
                // Pas de liste de collision scriptée : on retombe sur l'ancien
                // comportement (une seule ligne par table), en excluant la
                // ligne elle-même comme le ferait Postgres avec `.neq('id', …)`.
                const excluded = Boolean(row && excludedId !== undefined && row.id === excludedId);
                return { data: excluded ? null : (row ?? null), error: null };
            },
            single: async () => ({ data: row ?? null, error: null }),
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

    it('n’est pas trompée par une virgule dans le mmsi (pas de collision réelle)', async () => {
        mockAdminFrom.mockImplementation(tableStub(
            {
                vessel_identity_candidates: { ...CANDIDATE, mmsi: '671882000,mmsi.eq.999' },
                vessels: PLACEHOLDER_VESSEL,
            },
            { vesselCollisions: [] },
        ));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toMatchObject({ ok: true, emailApplied: true });
    });

    it('refuse une collision réelle sur le mmsi (autre navire)', async () => {
        const OTHER_VESSEL: OtherVesselRow = {
            id: '44444444-4444-4444-4444-444444444444',
            imo_number: '0000000',
            mmsi: CANDIDATE.mmsi,
        };
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: PLACEHOLDER_VESSEL },
            { vesselCollisions: [OTHER_VESSEL] },
        ));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toEqual({ ok: false, reason: 'identity already held by another vessel' });
        expect(mockUpsertEmail).not.toHaveBeenCalled();
    });
});
