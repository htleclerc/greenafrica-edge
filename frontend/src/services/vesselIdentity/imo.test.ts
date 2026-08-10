import { describe, it, expect } from 'vitest';
import { isValidImo } from './imo';

describe('isValidImo', () => {
    it("accepte les IMO réels de l'export d'escales", () => {
        for (const imo of ['9235957', '7504158', '9167057', '1152604', '6422303']) {
            expect(isValidImo(imo)).toBe(true);
        }
    });

    it('rejette une somme de contrôle fausse', () => {
        expect(isValidImo('9235958')).toBe(false);
    });

    it("rejette ce qui n'est pas sept chiffres", () => {
        expect(isValidImo('0')).toBe(false);
        expect(isValidImo('123456')).toBe(false);
        expect(isValidImo('12345678')).toBe(false);
        expect(isValidImo('UNVERIFIED-nav-042')).toBe(false);
        expect(isValidImo('à confirmer')).toBe(false);
        expect(isValidImo('Hors registre Equasis')).toBe(false);
        expect(isValidImo('')).toBe(false);
    });
});
