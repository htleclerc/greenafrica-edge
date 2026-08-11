import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockFrom, mockAdminFrom, mockLoadSanctioned } = vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockFrom: vi.fn(),
    mockAdminFrom: vi.fn(),
    mockLoadSanctioned: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: mockAuth }, from: mockFrom }),
}));
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({ from: mockAdminFrom }) }));
vi.mock('@/services/vesselIdentity/vesselIdentityService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/vesselIdentity/vesselIdentityService')>();
    return { ...actual, loadSanctionedEntities: mockLoadSanctioned };
});

import { createManualCandidate } from './createManualCandidate';

const VALID = {
    imoNumber: '9424223',
    vesselName: 'NYALA',
    mmsi: '341581000',
    flagCode: 'KN',
    typeRaw: 'Oil Products Tanker',
    grossTonnage: 5000,
    deadweight: 8000,
    buildYear: 2010,
    managerName: 'SOME MANAGER LTD',
    managerEmail: 'ops@some-manager.com',
};

let inserted: Record<string, unknown> | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    inserted = null;
    mockAuth.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockImplementation(() => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'PORT_OFFICER' }, error: null }) }) }),
    }));
    mockAdminFrom.mockImplementation(() => ({
        insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { select: () => ({ single: async () => ({ data: { id: 'cand-1' }, error: null }) }) };
        },
    }));
    mockLoadSanctioned.mockResolvedValue([]);
});

describe('createManualCandidate', () => {
    it('crée un candidat de source MANUAL', async () => {
        const r = await createManualCandidate(VALID);
        expect(r).toEqual({ ok: true, candidateId: 'cand-1' });
        expect(inserted).toMatchObject({ source: 'MANUAL', imo_number: '9424223', status: 'PENDING' });
    });

    it('refuse un IMO dont la somme de contrôle est fausse — la garde de la saisie manuelle', async () => {
        const r = await createManualCandidate({ ...VALID, imoNumber: '9424224' });
        expect(r).toEqual({ ok: false, reason: 'somme de contrôle IMO invalide' });
        expect(inserted).toBeNull();
    });

    it('refuse un type de navire inconnu', async () => {
        const r = await createManualCandidate({ ...VALID, typeRaw: 'Submersible Drilling Rig' });
        expect(r.ok).toBe(false);
        expect(inserted).toBeNull();
    });

    it('marque le contact bloqué quand la société est sous sanctions', async () => {
        mockLoadSanctioned.mockResolvedValue([
            { id: 'arm-012', name: 'Petrofleet Shipping', aliases: ['Petrofleet'] },
        ]);
        const r = await createManualCandidate({
            ...VALID, managerName: 'PETROFLEET ENERGY TRADING LLC', managerEmail: 'info@petrofleetenergy.example',
        });
        expect(r.ok).toBe(true);
        expect(inserted).toMatchObject({
            contact_blocked: true,
            contact_blocked_reason: 'manager sous sanctions : Petrofleet Shipping (arm-012)',
        });
    });

    it('enregistre les trois niveaux de contact saisis', async () => {
        // 15 des 47 navires joignables de l'export ne le sont que par l'owner
        // ou l'ISM manager : les perdre reviendrait à les rendre injoignables.
        const r = await createManualCandidate({
            ...VALID,
            ownerName: 'UNIVERSAL SHIPPING & LOGISTIC',
            ownerEmail: 'ops@universal-shipping.com',
            ismManagerName: 'FAROS SHIPPING CO SARL',
            ismManagerEmail: 'faros@farosshipping.example',
        });
        expect(r.ok).toBe(true);
        expect(inserted).toMatchObject({
            owner_name: 'UNIVERSAL SHIPPING & LOGISTIC',
            owner_email: 'ops@universal-shipping.com',
            ism_manager_name: 'FAROS SHIPPING CO SARL',
            ism_manager_email: 'faros@farosshipping.example',
        });
    });

    it('rend un motif lisible plutôt que le message brut de Postgres', async () => {
        mockAdminFrom.mockImplementation(() => ({
            insert: () => ({
                select: () => ({
                    single: async () => ({
                        data: null,
                        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                    }),
                }),
            }),
        }));
        expect(await createManualCandidate(VALID)).toEqual({
            ok: false, reason: 'candidate already exists',
        });
    });

    it('refuse un rôle insuffisant', async () => {
        mockFrom.mockImplementation(() => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'SHIPPING_AGENT' }, error: null }) }) }),
        }));
        expect(await createManualCandidate(VALID)).toEqual({ ok: false, reason: 'insufficient role' });
    });
});
