import { describe, it, expect } from 'vitest';
import {
    clampStatusesForPaymentsOnly, currentMonthStart, forceCurrentMonthProformas,
    isPaymentsOnlyAllowed, isPaymentsOnlyGuarded, PAYMENTS_ONLY_NAV,
} from './paymentsOnly';
import { filterNavItems } from '@/lib/rbac';
import { UserRole } from '@/types/secure';
import { loginDestination } from './loginDestination';

describe('paymentsOnly — chemins', () => {
    it('laisse passer paiements, portefeuilles, navires et factures (liste seule), et le compte personnel', () => {
        for (const p of [
            '/admin/payments', '/admin/payments/', '/admin/wallets', '/admin/wallets/w-1',
            '/admin/navires', '/admin/invoices',
            '/dashboard/settings', '/dashboard/account/security',
            '/api/admin/payments', '/api/admin/payments/abc', '/api/admin/wallets/x',
            '/api/receipts/RCT-1/download', '/mfa', '/post-login',
        ]) {
            expect(isPaymentsOnlyAllowed(p), p).toBe(true);
        }
    });

    it('refuse créances, encours, réglages, annuaire et fournisseurs de paiement', () => {
        for (const p of [
            '/admin/users', '/admin/settings', '/admin/settings?tab=portail', '/api/admin/payment-config',
            '/admin/armateurs', '/admin/armateurs/arm_1/portail', '/admin/navires/ves_1/portail', '/admin/navires/ves_1/portail/invoices',
            '/admin/invoices/anything', '/admin/reglements', '/admin/collections', '/admin/revenue', '/admin/refunds',
            '/dashboard', '/dashboard/invoices', '/dashboard/vessels', '/api/admin/shipowners/x', '/admin/paymentsfoo',
        ]) {
            expect(isPaymentsOnlyAllowed(p), p).toBe(false);
        }
    });

    it("ne s'exerce que sur les surfaces staff", () => {
        expect(isPaymentsOnlyGuarded('/admin/invoices')).toBe(true);
        expect(isPaymentsOnlyGuarded('/api/admin/payments')).toBe(true);
        expect(isPaymentsOnlyGuarded('/dashboard')).toBe(true);
        expect(isPaymentsOnlyGuarded('/api/transactions/abc/proof')).toBe(true);
        expect(isPaymentsOnlyGuarded('/api/kpis')).toBe(true);
        expect(isPaymentsOnlyGuarded('/api/invoices/generate')).toBe(true);
        expect(isPaymentsOnlyGuarded('/api/invoices/PRO-1/download')).toBe(false);
        expect(isPaymentsOnlyGuarded('/owner/invoices')).toBe(false);
        expect(isPaymentsOnlyGuarded('/verify/PRO-1')).toBe(false);
        expect(isPaymentsOnlyGuarded('/administration')).toBe(false);
    });
});

describe('paymentsOnly — statuts', () => {
    it("borne à l'argent qui a bougé, CONFIRMED par défaut", () => {
        expect(clampStatusesForPaymentsOnly([])).toEqual(['CONFIRMED']);
        expect(clampStatusesForPaymentsOnly(['INITIATED', 'PROCESSING'])).toEqual(['CONFIRMED']);
        expect(clampStatusesForPaymentsOnly(['CONFIRMED', 'INITIATED', 'REFUNDED'])).toEqual(['CONFIRMED', 'REFUNDED']);
    });
});

describe('paymentsOnly — pro-formas du mois en cours', () => {
    it('trouve le premier du mois, quel que soit le jour', () => {
        expect(currentMonthStart(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09-01');
        expect(currentMonthStart(new Date('2026-09-10T12:00:00Z'))).toBe('2026-09-01');
        expect(currentMonthStart(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09-01');
    });

    // Bascule de mois : le 1er ne doit pas rendre le mois precedent.
    it('bascule au premier jour du mois suivant', () => {
        expect(currentMonthStart(new Date('2026-08-31T23:00:00Z'))).toBe('2026-08-01');
        expect(currentMonthStart(new Date('2026-10-01T00:30:00Z'))).toBe('2026-10-01');
    });

    it('tient sur les mois courts et le passage d’année', () => {
        expect(currentMonthStart(new Date('2026-02-28T12:00:00Z'))).toBe('2026-02-01');
        expect(currentMonthStart(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01-01');
    });

    it('ramène tout filtre plus large au mois, et aux seules pro-formas', () => {
        const now = new Date('2026-09-10T12:00:00Z');
        expect(forceCurrentMonthProformas({ documentType: 'FINAL', dateFrom: '2026-01-01' }, now))
            .toEqual({ documentType: 'PROFORMA', dateFrom: '2026-09-01' });
        expect(forceCurrentMonthProformas({ documentType: null, dateFrom: null }, now))
            .toEqual({ documentType: 'PROFORMA', dateFrom: '2026-09-01' });
    });

    it('garde un filtre plus étroit que le mois', () => {
        const now = new Date('2026-09-10T12:00:00Z');
        expect(forceCurrentMonthProformas({ dateFrom: '2026-09-09' }, now).dateFrom).toBe('2026-09-09');
    });

    // La fenetre s'elargit, elle ne s'ouvre pas : le type reste impose.
    it('n’ouvre jamais les factures finales, même sur un filtre explicite', () => {
        const now = new Date('2026-09-10T12:00:00Z');
        expect(forceCurrentMonthProformas({ documentType: 'FINAL', dateFrom: '2026-09-09' }, now).documentType)
            .toBe('PROFORMA');
    });
});

describe('paymentsOnly — menu et atterrissage', () => {
    const items = ['payments', 'wallets', 'users', 'navires', 'admin-invoices', 'admin-settings', 'settings', 'armateurs', 'reglements', 'refunds', 'revenue', 'admin-collections']
        .map((key) => ({ key }));

    it('retranche le menu d’un FINANCE_ADMIN à la caisse, sans recouvrement, réglages ni annuaire', () => {
        const keys = filterNavItems(items, UserRole.FINANCE_ADMIN, false, true).map((i) => i.key);
        expect(keys).toEqual(['payments', 'wallets', 'navires', 'admin-invoices', 'settings']);
        expect(PAYMENTS_ONLY_NAV).toEqual(keys);
    });

    it("n'accorde rien à un rôle qui n'avait pas les paiements", () => {
        const keys = filterNavItems(items, UserRole.PORT_OFFICER, false, true).map((i) => i.key);
        expect(keys).not.toContain('payments');
        expect(keys).not.toContain('wallets');
    });

    it('atterrit sur les paiements, avant le poste de recouvrement', () => {
        expect(loginDestination({ isOperator: false, role: UserRole.FINANCE_ADMIN, paymentsOnly: true })).toBe('/admin/payments');
        expect(loginDestination({ isOperator: false, role: UserRole.FINANCE_ADMIN, collectionsFocus: true, paymentsOnly: true })).toBe('/admin/payments');
    });
});
