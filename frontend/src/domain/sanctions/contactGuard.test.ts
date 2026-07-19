import { describe, it, expect } from 'vitest';
import {
    assertContactAllowed,
    isContactBlocked,
    SanctionedContactError,
} from './contactGuard';

describe('contactGuard', () => {
    const clean = { is_ofac_sdn: false, is_un_prohibited: false, name: 'H&P Ship Management Ltd' };
    const ofac = { is_ofac_sdn: true, is_un_prohibited: false, name: 'IRISL Group / Valfajr Shipping' };
    const un = { is_ofac_sdn: false, is_un_prohibited: true, name: 'Morgan Navigation SA' };

    it('OFAC armateur cannot receive email', () => {
        expect(() => assertContactAllowed(ofac)).toThrow(SanctionedContactError);
        try {
            assertContactAllowed(ofac);
        } catch (e) {
            expect(e).toBeInstanceOf(SanctionedContactError);
            expect((e as SanctionedContactError).code).toBe('OFAC_SDN');
            expect((e as SanctionedContactError).shipownerName).toBe(ofac.name);
        }
    });

    it('UN prohibited armateur cannot receive email', () => {
        expect(() => assertContactAllowed(un)).toThrow(SanctionedContactError);
        try {
            assertContactAllowed(un);
        } catch (e) {
            expect((e as SanctionedContactError).code).toBe('UN_PROHIBITED');
        }
    });

    it('does not throw for a clean armateur', () => {
        expect(() => assertContactAllowed(clean)).not.toThrow();
        expect(isContactBlocked(clean)).toBe(false);
        expect(isContactBlocked(ofac)).toBe(true);
        expect(isContactBlocked(un)).toBe(true);
    });
});
