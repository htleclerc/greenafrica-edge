import { describe, it, expect } from 'vitest';
import { compareValues } from './useClientSort';

describe('compareValues', () => {
    it('ordonne les nombres croissant puis décroissant', () => {
        expect(compareValues(1, 2, 'asc')).toBeLessThan(0);
        expect(compareValues(1, 2, 'desc')).toBeGreaterThan(0);
    });

    it('ordonne les chaînes sans tenir compte de la casse', () => {
        expect(compareValues('alpha', 'Beta', 'asc')).toBeLessThan(0);
    });

    it('place null en fin QUEL QUE SOIT le sens', () => {
        // Un armateur sans échéance ne doit jamais remonter en tête d'un tri
        // décroissant sur l'échéance : l'absence de donnée n'est pas une valeur.
        expect(compareValues(null, 5, 'asc')).toBeGreaterThan(0);
        expect(compareValues(null, 5, 'desc')).toBeGreaterThan(0);
        expect(compareValues(5, null, 'desc')).toBeLessThan(0);
    });

    it('renvoie 0 sur deux null', () => {
        expect(compareValues(null, null, 'asc')).toBe(0);
    });
});
