import { describe, it, expect } from 'vitest';
import { OPERATOR_NAV, operatorNavFor, vesselsNavLabelKey, isAirOnly, type OperatorMode } from './operatorNav';

describe('OPERATOR_NAV', () => {
    it('has exactly 9 items', () => {
        expect(OPERATOR_NAV).toHaveLength(10);
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
            'my-fleet',
            'invoices',
            'wallet',
            'simulator',
            'tco',
            'disputes',
            'notifications',
            'account',
        ]);
    });
});

describe('operatorNavFor', () => {
    it('expose la gestion de flotte a un armateur maritime', () => {
        // Le panneau libre-service existait deja, sans aucun lien vers lui :
        // l'armateur ne pouvait ni renommer, ni retirer, ni contester un
        // navire sans taper l'URL a la main.
        const keys = operatorNavFor(['MARITIME']).map((i) => i.key);
        expect(keys).toContain('my-fleet');
        expect(operatorNavFor(['MARITIME', 'AIR']).map((i) => i.key)).toContain('my-fleet');
    });

    it('la retire a un exploitant exclusivement aerien', () => {
        // listOwnerFleet ne lit que `vessels` : l'entree ouvrirait un ecran vide.
        const nav = operatorNavFor(['AIR']);
        expect(nav.map((i) => i.key)).not.toContain('my-fleet');
        expect(nav).toHaveLength(OPERATOR_NAV.length - 1);
    });

    it('rend la liste complete quand les modes sont inconnus', () => {
        expect(operatorNavFor([])).toEqual(OPERATOR_NAV);
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
