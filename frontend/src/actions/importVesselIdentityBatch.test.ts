import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockFrom, mockInsertCandidates, mockLoadSanctioned } = vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockFrom: vi.fn(),
    mockInsertCandidates: vi.fn(),
    mockLoadSanctioned: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: mockAuth }, from: mockFrom }),
}));
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({ from: vi.fn() }) }));
vi.mock('@/services/vesselIdentity/vesselIdentityService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/vesselIdentity/vesselIdentityService')>();
    return { ...actual, insertCandidates: mockInsertCandidates, loadSanctionedEntities: mockLoadSanctioned };
});

import { importVesselIdentityBatch } from './importVesselIdentityBatch';

const HEADER =
    '"MMSI","IMO","SHIP NAME","TYPE","DRAUGHT","DATE TIME (UTC)","EVENT","PORT NAME","LOCODE",' +
    'CALLSIGN,BUILT,FLAG,FLAGNAME,TYPE,TYPENAME,STATUS,GT,DWT,LOA,LPP,BEAM,DRAUGHT,CLASS,CLASSCODE,' +
    'MANAGER_NAME,MANAGER_COUNTRY,MANAGER_ADDRESS,MANAGER_WEB,MANAGER_EMAIL,MANAGER_PHONE,MANAGER_FAX,' +
    'OWNER_NAME,OWNER_COUNTRY,OWNER_ADDRESS,OWNER_WEB,OWNER_EMAIL,OWNER_PHONE,OWNER_FAX,' +
    'ISM_MANAGER_NAME,ISM_MANAGER_COUNTRY,ISM_MANAGER_ADDRESS,ISM_MANAGER_WEB,ISM_MANAGER_EMAIL,' +
    'ISM_MANAGER_PHONE,ISM_MANAGER_FAX,PI_COMPANY,PI_INCEPTION';

const TRUST1 =
    '671882000,7504158,"TRUST 1",70,5.0,"2026-05-01 05:21:13","ENTER_ZONE","Berbera Anch.","SOBBO",5VEV4,1975,TG,Togo,A38A,Livestock Carrier,IN SERVICE/COMMISSION,2975,2560,74,55,12,5,CAR,CAR,' +
    'FAROS SHIPPING CO SARL,LB,"Beirut.",,faros@farosshipping.example,,,' +
    'UNIVERSAL SHIPPING & LOGISTIC,LB,"Beirut.",,,,,' +
    'FAROS SHIPPING CO SARL,LB,"Beirut.",,faros@farosshipping.example,,,,0000-00-00';

const NAFISA =
    '417078690,0,"NAFISA",90,0.0,"2026-05-02 04:19:37","EXIT_ZONE","Berbera","SOBBO",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,';

beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockImplementation(() => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'PORT_OFFICER', full_name: 'O' }, error: null }) }) }),
    }));
    mockLoadSanctioned.mockResolvedValue([]);
    mockInsertCandidates.mockResolvedValue(1);
});

describe('importVesselIdentityBatch', () => {
    it('insère les candidats et rend compte des rejets', async () => {
        const r = await importVesselIdentityBatch({
            batchLabel: 'portcalls-mai-aout.csv',
            csv: [HEADER, TRUST1, NAFISA].join('\n'),
        });
        expect(r).toMatchObject({ ok: true, inserted: 1, rowsRead: 2 });
        if (r.ok) {
            expect(r.rejected).toEqual([
                { lineNumber: 3, vesselName: 'NAFISA', reason: 'IMO absent ou nul' },
            ]);
        }
    });

    it('refuse un rôle insuffisant', async () => {
        mockFrom.mockImplementation(() => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'SHIPPING_AGENT' }, error: null }) }) }),
        }));
        const r = await importVesselIdentityBatch({ batchLabel: 'x.csv', csv: [HEADER, TRUST1].join('\n') });
        expect(r).toEqual({ ok: false, reason: 'insufficient role' });
        expect(mockInsertCandidates).not.toHaveBeenCalled();
    });

    it('rend un message explicite sur un fichier qui n’est pas un export d’escales', async () => {
        const r = await importVesselIdentityBatch({ batchLabel: 'x.csv', csv: 'IMO,MMSI,FLAG,NAME,TYPE\n1,2,3,4,5' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/en-tête inattendu/i);
    });
});
