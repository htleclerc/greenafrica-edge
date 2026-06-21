import { describe, it, expect } from 'vitest';
import { OPERATOR_NAV, vesselsNavLabelKey, isAirOnly, type OperatorMode } from './operatorNav';

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

describe('vesselsNavLabelKey', () => {
    it('AIR only → nav.aircraft', () => {
        expect(vesselsNavLabelKey(['AIR'])).toBe('nav.aircraft');
    });

    it('MARITIME only → nav.vessels', () => {
        expect(vesselsNavLabelKey(['MARITIME'])).toBe('nav.vessels');
    });

    it('both modes → nav.fleet (order independent)', () => {
        expect(vesselsNavLabelKey(['MARITIME', 'AIR'])).toBe('nav.fleet');
        expect(vesselsNavLabelKey(['AIR', 'MARITIME'])).toBe('nav.fleet');
    });

    it('empty / unknown → nav.vessels (default, backwards compatible)', () => {
        expect(vesselsNavLabelKey([])).toBe('nav.vessels');
    });
});

describe('isAirOnly', () => {
    it('true only when AIR present and MARITIME absent', () => {
        expect(isAirOnly(['AIR'])).toBe(true);
        expect(isAirOnly(['MARITIME', 'AIR'] satisfies OperatorMode[])).toBe(false);
        expect(isAirOnly(['MARITIME'])).toBe(false);
        expect(isAirOnly([])).toBe(false);
    });
});
