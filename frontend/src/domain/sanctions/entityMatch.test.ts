import { describe, it, expect } from 'vitest';
import { significantTokens, matchesSanctionedEntity } from './entityMatch';

describe('significantTokens', () => {
    it('écarte les mots de forme juridique et de secteur', () => {
        expect([...significantTokens('Petrofleet Shipping')]).toEqual(['PETROFLEET']);
        expect([...significantTokens('PETROFLEET ENERGY TRADING LLC')]).toEqual(['PETROFLEET']);
    });

    it('conserve NAVIGATION, trop discriminant pour être écarté', () => {
        expect([...significantTokens('Morgan Navigation SA')]).toEqual(['MORGAN', 'NAVIGATION']);
    });

    it('ignore la ponctuation et les mots de moins de trois lettres', () => {
        expect([...significantTokens('H&P Ship Management Ltd')]).toEqual([]);
    });
});

describe('matchesSanctionedEntity', () => {
    it('reconnaît Petrofleet malgré une raison sociale divergente', () => {
        expect(matchesSanctionedEntity('PETROFLEET ENERGY TRADING LLC', ['Petrofleet Shipping', 'Petrofleet'])).toBe(true);
    });

    it('reconnaît Morgan Navigation malgré le suffixe CO SA', () => {
        expect(matchesSanctionedEntity('MORGAN NAVIGATION CO SA', ['Morgan Navigation SA'])).toBe(true);
    });

    it('reconnaît IRISL par son alias court', () => {
        expect(matchesSanctionedEntity('IRISL MARINE SERVICES', ['IRISL'])).toBe(true);
    });

    it('ne rapproche pas des sociétés sans jeton commun', () => {
        expect(matchesSanctionedEntity('FAROS SHIPPING CO SARL', ['Petrofleet Shipping', 'Morgan Navigation SA'])).toBe(false);
        expect(matchesSanctionedEntity('CORAL TECHNICAL SERVICES', ['Morgan Navigation SA'])).toBe(false);
    });

    it('ne matche jamais sur une référence sans jeton significatif', () => {
        expect(matchesSanctionedEntity('N IMPORTE QUOI', ['Ship Co Ltd'])).toBe(false);
    });

    it('tolère un nom candidat vide', () => {
        expect(matchesSanctionedEntity('', ['Petrofleet'])).toBe(false);
    });
});
