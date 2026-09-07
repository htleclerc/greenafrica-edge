import { describe, it, expect } from 'vitest';
import {
    clampStatusesForPaymentsOnly, currentIsoWeekStart, forceCurrentWeekProformas,
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

describe('paymentsOnly — pro-formas de la semaine en cours', () => {
    it('trouve le lundi ISO, dimanche compris', () => {
        expect(currentIsoWeekStart(new Date('2026-09-06T23:00:00Z'))).toBe('2026-08-31'); // dimanche
        expect(currentIsoWeekStart(new Date('2026-09-07T00:30:00Z'))).toBe('2026-09-07'); // lundi
        expect(currentIsoWeekStart(new Date('2026-09-10T12:00:00Z'))).toBe('2026-09-07'); // jeudi
    });

    it('ramène tout filtre plus large à la semaine, et aux seules pro-formas', () => {
        const now = new Date('2026-09-10T12:00:00Z');
        expect(forceCurrentWeekProformas({ documentType: 'FINAL', dateFrom: '2026-01-01' }, now))
            .toEqual({ documentType: 'PROFORMA', dateFrom: '2026-09-07' });
        expect(forceCurrentWeekProformas({ documentType: null, dateFrom: null }, now))
            .toEqual({ documentType: 'PROFORMA', dateFrom: '2026-09-07' });
    });

    it('garde un filtre plus étroit que la semaine', () => {
        const now = new Date('2026-09-10T12:00:00Z');
        expect(forceCurrentWeekProformas({ dateFrom: '2026-09-09' }, now).dateFrom).toBe('2026-09-09');
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
