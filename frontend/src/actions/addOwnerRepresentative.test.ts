import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn(async () => ({ data: { user: { id: 'staff-1', email: 'admin@greengate.africa' } } }));
const staffProfile = { role: 'SUPERADMIN', full_name: 'Admin GG' };
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser },
        from: () => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: staffProfile }) }) }),
        }),
    }),
}));

const OWNER = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'SUCCESS SHIPPING FZE',
    is_ofac_sdn: false,
    is_un_prohibited: false,
    jurisdiction_id: '00000000-0000-4000-8000-00000000534f',
};

let ownerRow: Record<string, unknown> | null = OWNER;
let mappingRows: { id: string; active: boolean }[] = [];
const insertMapping = vi.fn(async () => ({ error: null }));
const updateMapping = vi.fn(() => ({ eq: async () => ({ error: null }) }));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: (t: string) => {
            if (t === 'shipowners') {
                return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ownerRow }) }) }) };
            }
            return {
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            order: () => ({ limit: async () => ({ data: mappingRows, error: null }) }),
                        }),
                    }),
                }),
                insert: insertMapping,
                update: updateMapping,
            };
        },
    }),
}));

const provision = vi.fn(async () => ({ profileId: 'rep-1', created: true }));
vi.mock('@/services/ownerProvisioning', () => ({
    provisionOwnerAccount: (...a: unknown[]) => provision(...(a as [])),
}));

const audit = vi.fn(async () => undefined);
vi.mock('@/services/auditService', () => ({
    writeAuditLog: (...a: unknown[]) => audit(...(a as [])),
}));

const { addOwnerRepresentative } = await import('./addOwnerRepresentative');

const INPUT = {
    shipownerId: OWNER.id,
    email: 'gavaksh.b@rafflescommercial.com',
    fullName: 'Gavaksh B.',
};

beforeEach(() => {
    vi.clearAllMocks();
    ownerRow = { ...OWNER };
    mappingRows = [];
    staffProfile.role = 'SUPERADMIN';
    provision.mockResolvedValue({ profileId: 'rep-1', created: true });
});

describe('addOwnerRepresentative', () => {
    it('crée le compte du représentant et le rattache', async () => {
        const r = await addOwnerRepresentative(INPUT);
        expect(r).toEqual({ ok: true, profileId: 'rep-1', created: true });
        expect(provision).toHaveBeenCalledWith(expect.anything(), {
            email: 'gavaksh.b@rafflescommercial.com', fullName: 'Gavaksh B.',
        });
        expect(insertMapping).toHaveBeenCalledWith(expect.objectContaining({
            shipowner_id: OWNER.id, agent_profile_id: 'rep-1', active: true,
        }));
    });

    it('journalise le rattachement', async () => {
        await addOwnerRepresentative(INPUT);
        expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            action: 'TRANSACTION_UPDATED',
            entity_type: 'Shipowner',
            details_json: expect.objectContaining({ event: 'REPRESENTATIVE_ADDED' }),
        }));
    });

    it('refuse un rôle insuffisant', async () => {
        staffProfile.role = 'PORT_OFFICER';
        expect(await addOwnerRepresentative(INPUT)).toEqual({ ok: false, reason: 'insufficient role' });
        expect(provision).not.toHaveBeenCalled();
    });

    it('refuse un armateur sanctionné et le journalise en CRITICAL', async () => {
        ownerRow = { ...OWNER, name: 'MORGAN NAVIGATION CO SA', is_un_prohibited: true };
        const r = await addOwnerRepresentative(INPUT);
        expect(r.ok).toBe(false);
        // Aucun compte créé : la garde tombe AVANT toute écriture.
        expect(provision).not.toHaveBeenCalled();
        expect(insertMapping).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            action: 'SANCTIONS_CONTACT_BLOCKED', severity: 'CRITICAL',
        }));
    });

    it('ne double pas un rattachement déjà actif', async () => {
        mappingRows = [{ id: 'map-1', active: true }];
        const r = await addOwnerRepresentative(INPUT);
        expect(r.ok).toBe(true);
        expect(insertMapping).not.toHaveBeenCalled();
        expect(updateMapping).not.toHaveBeenCalled();
    });

    it('réactive un rattachement désactivé au lieu d’en créer un second', async () => {
        // La contrainte unique porte sur (shipowner_id, agent_profile_id,
        // valid_from) : insérer un autre jour créerait un doublon silencieux.
        mappingRows = [{ id: 'map-1', active: false }];
        const r = await addOwnerRepresentative(INPUT);
        expect(r.ok).toBe(true);
        expect(updateMapping).toHaveBeenCalledWith({ active: true });
        expect(insertMapping).not.toHaveBeenCalled();
    });

    it('refuse une adresse invalide', async () => {
        const r = await addOwnerRepresentative({ ...INPUT, email: 'pas-une-adresse' });
        expect(r.ok).toBe(false);
        expect(provision).not.toHaveBeenCalled();
    });

    it('refuse un armateur introuvable', async () => {
        ownerRow = null;
        expect(await addOwnerRepresentative(INPUT)).toEqual({ ok: false, reason: 'shipowner not found' });
    });

    it('remonte un échec de création de compte sans rattacher', async () => {
        provision.mockRejectedValue(new Error('compte existant introuvable'));
        const r = await addOwnerRepresentative(INPUT);
        expect(r).toEqual({ ok: false, reason: 'compte existant introuvable' });
        expect(insertMapping).not.toHaveBeenCalled();
    });
});
