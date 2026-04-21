import { describe, it, expect } from 'vitest';
import { canGenerateInvoice, STAFF_ROLES } from './route';

describe('canGenerateInvoice — who may POST /api/invoices/generate', () => {
    it('allows the 3 staff roles', () => {
        expect(canGenerateInvoice('PORT_OFFICER')).toBe(true);
        expect(canGenerateInvoice('FINANCE_ADMIN')).toBe(true);
        expect(canGenerateInvoice('SUPERADMIN')).toBe(true);
    });

    // REGRESSION GUARD — changed 2026-04-21. SHIPPING_AGENT used to return true
    // for tx on their own fleet; that path was removed so armateurs never trigger
    // the INVOICE_GENERATED audit in their own name.
    it('rejects SHIPPING_AGENT (armateurs do not generate, they consume)', () => {
        expect(canGenerateInvoice('SHIPPING_AGENT')).toBe(false);
    });

    it('rejects MANAGER (onboarding role, not invoicing)', () => {
        expect(canGenerateInvoice('MANAGER')).toBe(false);
    });

    it('rejects null / undefined / unknown role', () => {
        expect(canGenerateInvoice(null)).toBe(false);
        expect(canGenerateInvoice(undefined)).toBe(false);
        expect(canGenerateInvoice('')).toBe(false);
        expect(canGenerateInvoice('RANDOM_ROLE')).toBe(false);
    });

    it('STAFF_ROLES set size is 3 (exhaustiveness guard)', () => {
        expect(STAFF_ROLES.size).toBe(3);
    });
});
