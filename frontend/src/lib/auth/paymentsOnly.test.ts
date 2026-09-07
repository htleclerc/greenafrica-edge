import { describe, it, expect } from 'vitest';
import {
    clampStatusesForPaymentsOnly, isPaymentsOnlyAllowed, isPaymentsOnlyGuarded, PAYMENTS_ONLY_NAV,
} from './paymentsOnly';
import { filterNavItems } from '@/lib/rbac';
import { UserRole } from '@/types/secure';
import { loginDestination } from './loginDestination';

describe('paymentsOnly — chemins', () => {
    it('ne laisse passer que les paiements, le compte et les réglages personnels', () => {
        for (const p of ['/admin/payments', '/admin/payments/', '/dashboard/settings', '/dashboard/account/security', '/api/admin/payments', '/api/admin/payments/abc', '/api/receipts/RCT-1/download', '/mfa', '/post-login']) {
            expect(isPaymentsOnlyAllowed(p), p).toBe(true);
        }
    });

    it('refuse tout ce qui montre une créance ou un encours', () => {
        for (const p of ['/admin/invoices', '/admin/armateurs', '/admin/armateurs/arm_1/portail', '/admin/navires', '/admin/reglements', '/admin/collections', '/admin/revenue', '/admin/settings', '/dashboard', '/dashboard/invoices', '/dashboard/vessels', '/api/admin/shipowners/x', '/api/admin/payment-config', '/admin/paymentsfoo']) {
            expect(isPaymentsOnlyAllowed(p), p).toBe(false);
        }
    });

    it("ne s'exerce que sur les surfaces staff", () => {
        expect(isPaymentsOnlyGuarded('/admin/invoices')).toBe(true);
        expect(isPaymentsOnlyGuarded('/api/admin/payments')).toBe(true);
        expect(isPaymentsOnlyGuarded('/dashboard')).toBe(true);
        // API legacy sans écran mais joignables à la main : transactions, KPIs, journal, émission.
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

describe('paymentsOnly — menu et atterrissage', () => {
    const items = ['payments', 'admin-invoices', 'armateurs', 'reglements', 'settings', 'refunds', 'revenue'].map((key) => ({ key }));

    it('retranche le menu d’un FINANCE_ADMIN aux seuls paiements', () => {
        const keys = filterNavItems(items, UserRole.FINANCE_ADMIN, false, true).map((i) => i.key);
        expect(keys).toEqual(['payments', 'settings']);
        expect(PAYMENTS_ONLY_NAV).toEqual(['payments', 'settings']);
    });

    it("n'accorde rien à un rôle qui n'avait pas les paiements", () => {
        const keys = filterNavItems(items, UserRole.PORT_OFFICER, false, true).map((i) => i.key);
        expect(keys).toEqual(['settings']);
    });

    it('atterrit sur les paiements, avant le poste de recouvrement', () => {
        expect(loginDestination({ isOperator: false, role: UserRole.FINANCE_ADMIN, paymentsOnly: true })).toBe('/admin/payments');
        expect(loginDestination({ isOperator: false, role: UserRole.FINANCE_ADMIN, collectionsFocus: true, paymentsOnly: true })).toBe('/admin/payments');
    });
});
