import { describe, it, expect } from 'vitest';
import { viewAsAccess } from './viewAsOwner';
import { portalPaths } from './portalPaths';

describe('viewAsAccess', () => {
    it('admet les quatre rôles staff, montants cachés au PORT_OFFICER (arbitrage PO)', () => {
        expect(viewAsAccess('SUPERADMIN')).toEqual({ allowed: true, canViewBilling: true });
        expect(viewAsAccess('FINANCE_ADMIN')).toEqual({ allowed: true, canViewBilling: true });
        expect(viewAsAccess('MANAGER')).toEqual({ allowed: true, canViewBilling: true });
        expect(viewAsAccess('PORT_OFFICER')).toEqual({ allowed: true, canViewBilling: false });
    });

    it('refuse un armateur, un inconnu et l’absence de rôle', () => {
        expect(viewAsAccess('SHIPPING_AGENT').allowed).toBe(false);
        expect(viewAsAccess('INSPECTOR').allowed).toBe(false);
        expect(viewAsAccess(null).allowed).toBe(false);
    });
});

describe('portalPaths', () => {
    it('vise /dashboard pour un vrai armateur, actions ouvertes', () => {
        const p = portalPaths({});
        expect(p.invoices).toBe('/dashboard/invoices');
        expect(p.vessel('ves_7f3a9c2e51b0')).toBe('/dashboard/vessels/ves_7f3a9c2e51b0');
        expect(p.readOnly).toBe(false);
        expect(p.hideAmounts).toBe(false);
    });

    it('reste dans la vue admin d’un compte, en lecture seule', () => {
        const p = portalPaths({ viewAs: { basePath: '/admin/armateurs/arm_1/portail', ownerRef: 'arm_1', ownerName: 'X', canViewBilling: true, query: '' } });
        expect(p.invoices).toBe('/admin/armateurs/arm_1/portail/invoices');
        expect(p.fleet).toBe('/admin/armateurs/arm_1/portail/fleet');
        expect(p.vessel('ves_a')).toBe('/admin/armateurs/arm_1/portail/fleet/ves_a');
        expect(p.readOnly).toBe(true);
        expect(p.hideAmounts).toBe(false);
    });

    it('en portée navire, flotte et détail sont le même écran ; montants masqués sans droit', () => {
        const p = portalPaths({ viewAs: {
            basePath: '/admin/navires/ves_a/portail', ownerRef: 'arm_1', ownerName: 'X', canViewBilling: false,
            vessel: { id: 'v', ref: 'ves_a', name: 'ALIMAN' }, query: '',
        } });
        expect(p.fleet).toBe('/admin/navires/ves_a/portail');
        expect(p.vessel('anything')).toBe('/admin/navires/ves_a/portail');
        expect(p.invoices).toBe('/admin/navires/ves_a/portail/invoices');
        expect(p.hideAmounts).toBe(true);
    });
});

describe('portalPaths — membre regardé', () => {
    it('reconduit ?as=mbr_… sur chaque lien, pour rester dans la peau du membre', () => {
        const p = portalPaths({ viewAs: {
            basePath: '/admin/armateurs/arm_1/portail', ownerRef: 'arm_1', ownerName: 'X', canViewBilling: true,
            member: { ref: 'mbr_7f3a9c2e51b0', name: 'Amina', email: null }, query: '?as=mbr_7f3a9c2e51b0',
        } });
        expect(p.invoices).toBe('/admin/armateurs/arm_1/portail/invoices?as=mbr_7f3a9c2e51b0');
        expect(p.vessel('ves_a')).toBe('/admin/armateurs/arm_1/portail/fleet/ves_a?as=mbr_7f3a9c2e51b0');
        expect(p.wallet).toBe('/admin/armateurs/arm_1/portail/wallet?as=mbr_7f3a9c2e51b0');
    });
});
