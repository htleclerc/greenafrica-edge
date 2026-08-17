import { describe, it, expect } from 'vitest';
import { type SupabaseClient } from '@supabase/supabase-js';
import {
    flagSanctionedCandidates,
    insertCandidates,
    loadSanctionedEntities,
    type FlaggedCandidate,
    type SanctionedEntity,
} from './vesselIdentityService';
import type { VesselFinderCandidate } from './vesselFinderParser';

const base: VesselFinderCandidate = {
    imoNumber: '9167057', mmsi: '341264001', callSign: 'V4LK5', vesselName: 'MAYAR',
    flagCode: 'KN', typeRaw: 'Livestock Carrier', category: 'CARGO',
    grossTonnage: 4752, deadweight: 4200, buildYear: 1998,
    managerName: 'LEVANTE MARITTIMO CO', managerCountry: 'MH', managerEmail: null,
    ownerName: 'LEVANTE MARITTIMO CO', ownerCountry: 'MH', ownerEmail: null,
    ismManagerName: 'MORGAN NAVIGATION CO SA', ismManagerEmail: 'morgan.navigation@mail.example',
    lastSeenAt: '2026-05-01 07:33:31',
};

const SANCTIONED: SanctionedEntity[] = [
    { id: 'arm-012', name: 'Petrofleet Shipping', aliases: ['Petrofleet'] },
    { id: 'arm-013', name: 'Morgan Navigation SA', aliases: ['Morgan Nav Beirut'] },
];

describe('flagSanctionedCandidates', () => {
    it('bloque un candidat dont le ISM manager est sous sanctions', () => {
        const [c] = flagSanctionedCandidates([base], SANCTIONED);
        expect(c.contactBlocked).toBe(true);
        expect(c.contactBlockedReason).toBe('ISM manager sous sanctions : Morgan Navigation SA (arm-013)');
    });

    it('bloque un candidat dont le manager est sous sanctions', () => {
        const mtSahil = { ...base, imoNumber: '8619003', vesselName: 'MT SAHIL',
            managerName: 'PETROFLEET ENERGY TRADING LLC', managerEmail: 'info@petrofleetenergy.example',
            ismManagerName: 'PETROFLEET ENERGY TRADING LLC', ismManagerEmail: 'info@petrofleetenergy.example' };
        const [c] = flagSanctionedCandidates([mtSahil], SANCTIONED);
        expect(c.contactBlocked).toBe(true);
        expect(c.contactBlockedReason).toBe('manager sous sanctions : Petrofleet Shipping (arm-012)');
    });

    it('laisse passer un candidat sans lien de sanction', () => {
        const trust1 = { ...base, imoNumber: '7504158', vesselName: 'TRUST 1',
            managerName: 'FAROS SHIPPING CO SARL', managerEmail: 'faros@farosshipping.example',
            ownerName: 'UNIVERSAL SHIPPING & LOGISTIC',
            ismManagerName: 'FAROS SHIPPING CO SARL', ismManagerEmail: 'faros@farosshipping.example' };
        const [c] = flagSanctionedCandidates([trust1], SANCTIONED);
        expect(c.contactBlocked).toBe(false);
        expect(c.contactBlockedReason).toBeNull();
    });

    it('ne bloque rien quand la liste de sanctions est vide', () => {
        const [c] = flagSanctionedCandidates([base], []);
        expect(c.contactBlocked).toBe(false);
    });
});

describe('insertCandidates', () => {
    /**
     * Le payload est la seule chose qui compte ici : les noms de colonnes de la
     * migration 115 n'ont jamais été confrontés à une base réelle (stack locale
     * indisponible), et la confusion GT/DWT changerait le montant de toutes les
     * factures — `proformaPipelineService` transmet `gross_tonnage_dwt` à l'API
     * fiscale sous le nom `gross_tonnage`.
     */
    function insertStub() {
        const seen: { table?: string; rows?: Array<Record<string, unknown>> } = {};
        const db = {
            from: (table: string) => ({
                insert: async (rows: Array<Record<string, unknown>>) => {
                    seen.table = table;
                    seen.rows = rows;
                    return { error: null };
                },
            }),
        } as unknown as SupabaseClient;
        return { db, seen };
    }

    const flagged: FlaggedCandidate = {
        ...base, grossTonnage: 4752, deadweight: 4200,
        contactBlocked: false, contactBlockedReason: null,
    };

    it('écrit GT et DWT dans DEUX colonnes distinctes, et pose source/status', async () => {
        const { db, seen } = insertStub();
        const written = await insertCandidates(db, 'portcalls.csv', 'user-1', [flagged]);

        expect(written).toBe(1);
        expect(seen.table).toBe('vessel_identity_candidates');
        expect(seen.rows?.[0]).toMatchObject({
            batch_label: 'portcalls.csv',
            source: 'VESSELFINDER_PORTCALLS',
            status: 'PENDING',
            imported_by: 'user-1',
            imo_number: '9167057',
            vessel_name: 'MAYAR',
            gross_tonnage: 4752,
            deadweight: 4200,
            ism_manager_email: 'morgan.navigation@mail.example',
            contact_blocked: false,
        });
        expect(seen.rows?.[0].gross_tonnage).not.toBe(seen.rows?.[0].deadweight);
    });

    it('n’écrit rien et ne touche pas la base sur un lot vide', async () => {
        const { db, seen } = insertStub();
        expect(await insertCandidates(db, 'vide.csv', 'user-1', [])).toBe(0);
        expect(seen.table).toBeUndefined();
    });
});

describe('loadSanctionedEntities', () => {
    function selectStub(rows: Array<Record<string, unknown>>) {
        const seen: { table?: string; columns?: string; filter?: string } = {};
        const db = {
            from: (table: string) => {
                seen.table = table;
                return {
                    select: (columns: string) => {
                        seen.columns = columns;
                        return {
                            or: async (filter: string) => {
                                seen.filter = filter;
                                return { data: rows, error: null };
                            },
                        };
                    },
                };
            },
        } as unknown as SupabaseClient;
        return { db, seen };
    }

    it('filtre sur les DEUX drapeaux de sanctions et remonte les alias', async () => {
        const { db, seen } = selectStub([
            { id: 'arm-013', name: 'Morgan Navigation SA', aliases: ['Morgan Nav Beirut'] },
            { id: 'arm-012', name: 'Petrofleet Shipping', aliases: null },
        ]);
        const entities = await loadSanctionedEntities(db);

        expect(seen.table).toBe('shipowners');
        // Un seul drapeau interrogé laisserait passer la moitié du référentiel.
        expect(seen.filter).toContain('is_ofac_sdn.eq.true');
        expect(seen.filter).toContain('is_un_prohibited.eq.true');
        expect(entities).toEqual([
            { id: 'arm-013', name: 'Morgan Navigation SA', aliases: ['Morgan Nav Beirut'] },
            // `aliases` nul en base ne doit pas faire tomber le rapprochement.
            { id: 'arm-012', name: 'Petrofleet Shipping', aliases: [] },
        ]);
    });
});
