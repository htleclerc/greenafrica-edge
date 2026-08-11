import { describe, it, expect } from 'vitest';
import { flagSanctionedCandidates, type SanctionedEntity } from './vesselIdentityService';
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
