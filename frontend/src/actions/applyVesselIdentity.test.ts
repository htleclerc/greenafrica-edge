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

/** Écritures observées, pour vérifier les PAYLOADS et pas seulement les retours. */
interface Capture {
    updates: Array<{ table: string; payload: Record<string, unknown> }>;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
}

function newCapture(): Capture {
    return { updates: [], inserts: [] };
}

interface StubOptions {
    vesselCollisions?: OtherVesselRow[];
    /** Vrai ⇒ l'armateur du navire cible porte AU MOINS un autre navire. */
    sharedShipowner?: boolean;
    /** Vrai ⇒ la sonde « armateur partagé » échoue (coupure, 5xx, expiration). */
    sharedShipownerFails?: boolean;
    /** Vrai ⇒ la sonde de collision d'identité échoue. */
    identityProbeFails?: boolean;
    capture?: Capture;
}

/**
 * Construit un faux client dont chaque table renvoie une réponse scriptée.
 *
 * `vessels` est interrogée jusqu'à quatre fois avec des filtres différents :
 * une fois pour charger le navire cible (`.eq('id', vesselId)`), une ou deux
 * fois pour détecter une collision d'identité en excluant ce même navire
 * (`.neq('id', vessel.id).eq('imo_number', …)` puis, si besoin,
 * `.eq('mmsi', …)`), et une fois pour savoir si l'armateur du navire porte un
 * autre navire (`.eq('shipowner_id', …).neq('id', vessel.id)`). Une réponse
 * scriptée statique par table ne peut pas distinguer ces appels — sans le
 * filtrage ci-dessous, la ligne `vessels` scriptée se retrouverait comme
 * "collision" avec elle-même à chaque appariement réussi.
 *
 * `vesselCollisions`, quand fourni, simule une vraie recherche filtrée par
 * colonne (`imo_number` ou `mmsi`) parmi une liste de navires tiers — c'est
 * ce qui permet de vérifier que la garde 4 interroge bien la valeur exacte
 * de `candidate.mmsi` via `.eq()` plutôt que de la concaténer dans une
 * chaîne `.or()` où une virgule pourrait la détourner.
 *
 * `capture`, quand fourni, retient les payloads d'`update` et d'`insert` :
 * c'est le seul moyen de vérifier le point d'écriture lui-même — mapping
 * GT → `gross_tonnage_dwt`, absence des colonnes nulles, entrée d'audit.
 *
 * Le stub est **à état** : un `update()` modifie réellement la ligne scriptée,
 * si bien qu'une relecture ultérieure voit la nouvelle valeur. Sans cela, deux
 * appels successifs de l'action relisent une ligne figée et un enchaînement
 * — refus puis arbitrage sur le même candidat — ne peut pas être testé. Les
 * lignes reçues sont clonées à la construction, donc la mutation reste
 * confinée à un stub : deux tests qui partagent la même constante ne se
 * contaminent pas.
 */
function tableStub(responses: Record<string, unknown>, options?: StubOptions) {
    const state: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(responses)) {
        state[key] = value && typeof value === 'object' ? { ...value } : value;
    }
    return (table: string) => {
        const row = state[table] as { id?: unknown } | null | undefined;
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
            limit: () => chain,
            maybeSingle: async () => {
                // Sondage « cet armateur porte-t-il un autre navire ? » (garde 6).
                if (table === 'vessels' && 'shipowner_id' in filters) {
                    if (options?.sharedShipownerFails) {
                        return { data: null, error: { message: 'PostgREST 503' } };
                    }
                    return {
                        data: options?.sharedShipowner ? { id: 'autre-navire' } : null,
                        error: null,
                    };
                }
                // Sonde de collision d'identité en panne (garde 4).
                if (table === 'vessels' && excludedId !== undefined && options?.identityProbeFails) {
                    return { data: null, error: { message: 'PostgREST 503' } };
                }
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
            update: (payload: Record<string, unknown>) => {
                options?.capture?.updates.push({ table, payload });
                // C'est ici que le stub prend son état : la ligne scriptée est
                // réellement modifiée, donc la lecture suivante la voit.
                if (row && typeof row === 'object') Object.assign(row, payload);
                return chain;
            },
            insert: async (payload: Record<string, unknown>) => {
                options?.capture?.inserts.push({ table, payload });
                return { error: null };
            },
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

    it('refuse une collision réelle sur l’IMO (autre navire) et passe le candidat en CONFLICT', async () => {
        const OTHER_VESSEL: OtherVesselRow = {
            id: '44444444-4444-4444-4444-444444444444',
            imo_number: CANDIDATE.imo_number,
            mmsi: '999999999',
        };
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: PLACEHOLDER_VESSEL },
            { vesselCollisions: [OTHER_VESSEL], capture },
        ));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toEqual({ ok: false, reason: 'identity already held by another vessel' });
        // Aucune écriture sur vessels : l'IMO est UNIQUE en base, la garde
        // doit trancher AVANT l'UPDATE.
        expect(capture.updates.filter((u) => u.table === 'vessels')).toHaveLength(0);
        expect(capture.updates).toContainEqual({
            table: 'vessel_identity_candidates',
            payload: { status: 'CONFLICT' },
        });
        expect(mockUpsertEmail).not.toHaveBeenCalled();
    });

    it('écrit un audit CRITICAL quand le contact est bloqué par les sanctions', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub(
            {
                vessel_identity_candidates: {
                    ...CANDIDATE, contact_blocked: true,
                    contact_blocked_reason: 'ISM manager sous sanctions : Morgan Navigation SA (arm-013)',
                    manager_email: null, ism_manager_email: 'morgan.navigation@mail.example',
                },
                vessels: PLACEHOLDER_VESSEL,
            },
            { capture },
        ));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toMatchObject({ ok: true, emailApplied: false, emailSkipped: 'CONTACT_BLOCKED' });

        const audit = capture.inserts.find(
            (i) => i.table === 'audit_logs' && i.payload.action === 'SANCTIONS_CONTACT_BLOCKED',
        );
        expect(audit).toBeDefined();
        expect(audit?.payload).toMatchObject({
            severity: 'CRITICAL',
            entity_type: 'Vessel',
            entity_id: PLACEHOLDER_VESSEL.id,
        });
        expect(audit?.payload.details_json).toMatchObject({
            event: 'VESSELFINDER_CONTACT_BLOCKED',
            reason: 'ISM manager sous sanctions : Morgan Navigation SA (arm-013)',
        });
    });

    it('écrit GT dans gross_tonnage_dwt et DWT dans dwt — le mapping qui fait le montant', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: PLACEHOLDER_VESSEL },
            { capture },
        ));
        expect((await applyVesselIdentity(INPUT)).ok).toBe(true);

        const write = capture.updates.find((u) => u.table === 'vessels');
        expect(write?.payload).toEqual({
            imo_number: '7504158',
            name: 'TRUST 1',
            mmsi: '671882000',
            call_sign: '5VEV4',
            flag_code: 'TG',
            category: 'CARGO',
            vessel_subtype: 'Livestock Carrier',
            gross_tonnage_dwt: 2975,
            dwt: 2560,
            build_year: 1975,
        });
    });

    it('n’écrase JAMAIS une colonne par null — un GT vide n’entre pas dans le payload', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub(
            {
                vessel_identity_candidates: {
                    ...CANDIDATE, gross_tonnage: null, deadweight: null,
                    build_year: null, call_sign: null, mmsi: null,
                },
                vessels: PLACEHOLDER_VESSEL,
            },
            { capture },
        ));
        expect((await applyVesselIdentity(INPUT)).ok).toBe(true);

        // gross_tonnage_dwt est INTEGER NOT NULL : l'inclure à null ferait
        // échouer l'UPDATE au niveau base, message Postgres brut à l'écran.
        const write = capture.updates.find((u) => u.table === 'vessels');
        expect(write?.payload).not.toHaveProperty('gross_tonnage_dwt');
        expect(write?.payload).not.toHaveProperty('dwt');
        expect(write?.payload).not.toHaveProperty('build_year');
        expect(write?.payload).not.toHaveProperty('mmsi');
        // L'identité, elle, est toujours écrite.
        expect(write?.payload).toMatchObject({ imo_number: '7504158', name: 'TRUST 1' });
    });

    it('n’écrit pas le contact quand l’armateur porte plus d’un navire', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: PLACEHOLDER_VESSEL },
            { sharedShipowner: true, capture },
        ));
        const r = await applyVesselIdentity(INPUT);
        // L'identité est appliquée, seul le contact est sauté : arm-014 porte
        // 83 navires, une écriture y enverrait 82 relances au mauvais manager.
        expect(r).toEqual({
            ok: true,
            vesselId: PLACEHOLDER_VESSEL.id,
            emailApplied: false,
            emailSkipped: 'SHARED_SHIPOWNER',
        });
        expect(mockUpsertEmail).not.toHaveBeenCalled();
        expect(capture.updates.find((u) => u.table === 'vessels')).toBeDefined();

        const audit = capture.inserts.find(
            (i) => i.table === 'audit_logs' && i.payload.action === 'TRANSACTION_UPDATED',
        );
        expect(audit?.payload.details_json).toMatchObject({ emailSkipped: 'SHARED_SHIPOWNER' });
    });

    it('saute le contact quand la sonde d’armateur partagé échoue', async () => {
        // Une erreur PostgREST rend `data = null` : sans contrôle de `error`,
        // la panne se lisait « pas de frère » et rouvrait l'écriture sur
        // arm-014. Ne pas savoir vaut ici « armateur partagé ».
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: PLACEHOLDER_VESSEL },
            { sharedShipownerFails: true },
        ));
        expect(await applyVesselIdentity(INPUT)).toMatchObject({
            ok: true, emailApplied: false, emailSkipped: 'SHARED_SHIPOWNER',
        });
        expect(mockUpsertEmail).not.toHaveBeenCalled();
    });

    it('échoue sans rien écrire quand la sonde de collision d’identité échoue', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: PLACEHOLDER_VESSEL },
            { identityProbeFails: true, capture },
        ));
        expect(await applyVesselIdentity(INPUT)).toEqual({
            ok: false, reason: 'identity check failed',
        });
        expect(capture.updates.filter((u) => u.table === 'vessels')).toHaveLength(0);
        expect(mockUpsertEmail).not.toHaveBeenCalled();
    });

    it('dit NO_EMAIL quand aucun des trois contacts n’a d’adresse', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: {
                ...CANDIDATE, manager_email: null, owner_email: null, ism_manager_email: null,
            },
            vessels: PLACEHOLDER_VESSEL,
        }));
        expect(await applyVesselIdentity(INPUT)).toMatchObject({
            ok: true, emailApplied: false, emailSkipped: 'NO_EMAIL',
        });
    });

    it('dit NO_SHIPOWNER quand le navire n’est rattaché à aucun armateur', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: CANDIDATE,
            vessels: { ...PLACEHOLDER_VESSEL, shipowner_id: null },
        }));
        expect(await applyVesselIdentity(INPUT)).toMatchObject({
            ok: true, emailApplied: false, emailSkipped: 'NO_SHIPOWNER',
        });
    });

    it('n’abandonne pas le candidat quand l’écriture du contact lève', async () => {
        const capture = newCapture();
        mockUpsertEmail.mockRejectedValue(new Error('shipowner introuvable'));
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: PLACEHOLDER_VESSEL },
            { capture },
        ));
        const r = await applyVesselIdentity(INPUT);
        // L'identité est écrite : laisser le candidat PENDING le bloquerait à
        // jamais derrière la garde « navire déjà identifié ».
        expect(r).toMatchObject({ ok: true, emailApplied: false });
        expect(capture.updates).toContainEqual(
            expect.objectContaining({
                table: 'vessel_identity_candidates',
                payload: expect.objectContaining({ status: 'MATCHED' }),
            }),
        );
        const audit = capture.inserts.find(
            (i) => i.table === 'audit_logs' && i.payload.action === 'TRANSACTION_UPDATED',
        );
        expect(audit?.payload.details_json).toMatchObject({ emailError: 'shipowner introuvable' });
    });
});

describe('applyVesselIdentity — garde de divergence de champs (§7.4)', () => {
    /** Navire déjà pourvu d'une jauge et d'un pavillon, différents du candidat. */
    const RENSEIGNE = {
        ...PLACEHOLDER_VESSEL,
        gross_tonnage_dwt: 5000,
        dwt: 4000,
        flag_code: 'KM',
        build_year: 1975,
    };

    it('refuse d’écraser une valeur renseignée divergente et rend la liste', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: RENSEIGNE },
            { capture },
        ));
        const r = await applyVesselIdentity(INPUT);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toBe('field conflict');
            expect(r.conflicts).toEqual([
                { field: 'gross_tonnage_dwt', current: '5000', proposed: '2975' },
                { field: 'dwt', current: '4000', proposed: '2560' },
                { field: 'flag_code', current: 'KM', proposed: 'TG' },
            ]);
        }
        // Aucune écriture : c'est tout l'intérêt de l'arbitrage.
        expect(capture.updates.filter((u) => u.table === 'vessels')).toHaveLength(0);
        expect(capture.updates).toContainEqual({
            table: 'vessel_identity_candidates',
            payload: { status: 'CONFLICT' },
        });
        expect(mockUpsertEmail).not.toHaveBeenCalled();
    });

    it('ne voit pas de divergence sur une valeur cible vide ni sur le nom', async () => {
        // Les placeholders s'appellent VESSEL-W4-xx : la divergence de nom est
        // la règle, elle n'a aucune portée fiscale et ne doit rien bloquer.
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: CANDIDATE,
            vessels: { ...PLACEHOLDER_VESSEL, name: 'VESSEL-W4-07', gross_tonnage_dwt: null },
        }));
        expect((await applyVesselIdentity(INPUT)).ok).toBe(true);
    });

    it('rouvre le candidat mis en CONFLICT et laisse l’arbitrage aboutir', async () => {
        // Aller-retour sur UN MÊME candidat, avec un stub à état : la garde 5
        // écrit CONFLICT, et la garde 2 doit accepter de le rouvrir. Sans cette
        // réentrée, le bouton « appliquer quand même » de l'écran se heurtait
        // invariablement à « candidate already processed » — et la divergence
        // est le chemin nominal, gross_tonnage_dwt étant toujours renseigné
        // par l'import d'onboarding.
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: RENSEIGNE },
            { capture },
        ));

        const premier = await applyVesselIdentity(INPUT);
        expect(premier).toMatchObject({ ok: false, reason: 'field conflict' });
        expect(capture.updates).toContainEqual({
            table: 'vessel_identity_candidates',
            payload: { status: 'CONFLICT' },
        });

        // Le statut a REELLEMENT changé : une nouvelle tentative sans
        // autorisation ne peut plus écraser en silence.
        const reprise = await applyVesselIdentity(INPUT);
        expect(reprise).toEqual({ ok: false, reason: 'candidate already processed' });

        // …mais l'arbitrage explicite passe, sur ce même candidat en CONFLICT.
        const arbitrage = await applyVesselIdentity({ ...INPUT, acceptFieldOverrides: true });
        expect(arbitrage).toMatchObject({ ok: true, vesselId: PLACEHOLDER_VESSEL.id });

        const write = capture.updates.find((u) => u.table === 'vessels');
        expect(write?.payload).toMatchObject({ gross_tonnage_dwt: 2975, dwt: 2560, flag_code: 'TG' });

        const audit = capture.inserts.find(
            (i) => i.table === 'audit_logs' && i.payload.action === 'TRANSACTION_UPDATED',
        );
        const details = audit?.payload.details_json as { overriddenFields?: unknown };
        expect(details.overriddenFields).toEqual([
            { field: 'gross_tonnage_dwt', current: '5000', proposed: '2975' },
            { field: 'dwt', current: '4000', proposed: '2560' },
            { field: 'flag_code', current: 'KM', proposed: 'TG' },
        ]);
        expect(capture.updates).toContainEqual(
            expect.objectContaining({
                table: 'vessel_identity_candidates',
                payload: expect.objectContaining({ status: 'MATCHED' }),
            }),
        );
    });

    it('ne rouvre pas un candidat MATCHED, même avec l’autorisation', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: { ...CANDIDATE, status: 'MATCHED' },
            vessels: RENSEIGNE,
        }));
        expect(await applyVesselIdentity({ ...INPUT, acceptFieldOverrides: true })).toEqual({
            ok: false, reason: 'candidate already processed',
        });
    });

    it('applique et trace les champs écrasés quand l’arbitrage est explicite', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub(
            { vessel_identity_candidates: CANDIDATE, vessels: RENSEIGNE },
            { capture },
        ));
        const r = await applyVesselIdentity({ ...INPUT, acceptFieldOverrides: true });
        expect(r).toMatchObject({ ok: true, emailApplied: true });

        const write = capture.updates.find((u) => u.table === 'vessels');
        expect(write?.payload).toMatchObject({ gross_tonnage_dwt: 2975, dwt: 2560, flag_code: 'TG' });

        const audit = capture.inserts.find(
            (i) => i.table === 'audit_logs' && i.payload.action === 'TRANSACTION_UPDATED',
        );
        const details = audit?.payload.details_json as { overriddenFields?: unknown };
        expect(details.overriddenFields).toEqual([
            { field: 'gross_tonnage_dwt', current: '5000', proposed: '2975' },
            { field: 'dwt', current: '4000', proposed: '2560' },
            { field: 'flag_code', current: 'KM', proposed: 'TG' },
        ]);
    });
});
