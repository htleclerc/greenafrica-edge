import { describe, it, expect } from 'vitest';
import { OPERATOR_NAV } from './operatorNav';

describe('OPERATOR_NAV', () => {
    it('has exactly 8 items', () => {
        expect(OPERATOR_NAV).toHaveLength(8);
    });

    it('every item has key, href, and labelKey', () => {
        for (const item of OPERATOR_NAV) {
            expect(typeof item.key).toBe('string');
            expect(item.key.length).toBeGreaterThan(0);
            expect(typeof item.href).toBe('string');
            expect(item.href.length).toBeGreaterThan(0);
            expect(typeof item.labelKey).toBe('string');
            expect(item.labelKey.length).toBeGreaterThan(0);
        }
    });

    it('every href starts with /dashboard', () => {
        for (const item of OPERATOR_NAV) {
            expect(item.href).toMatch(/^\/dashboard/);
        }
    });

    it('keys are in the expected order', () => {
        const keys = OPERATOR_NAV.map((i) => i.key);
        expect(keys).toEqual([
            'dashboard',
            'vessels',
            'invoices',
            'wallet',
            'simulator',
            'tco',
            'disputes',
            'notifications',
        ]);
    });
});
