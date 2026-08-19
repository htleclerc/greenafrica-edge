import { describe, it, expect } from 'vitest';
import { classifyVesselIdentifier, normalizeVesselIdentifier } from './identifier';

describe('normalizeVesselIdentifier', () => {
    it('accepte un IMO nu', () => {
        expect(normalizeVesselIdentifier('9424223')).toEqual({ kind: 'IMO', value: '9424223' });
    });

    it('accepte les formes copiées-collées depuis un PDF ou un site AIS', () => {
        for (const raw of ['IMO 9424223', 'IMO9424223', 'imo-9424223', '  9424223  ', 'IMO: 9424223']) {
            expect(normalizeVesselIdentifier(raw)).toEqual({ kind: 'IMO', value: '9424223' });
        }
    });

    it('accepte un MMSI à 9 chiffres', () => {
        expect(normalizeVesselIdentifier('341581000')).toEqual({ kind: 'MMSI', value: '341581000' });
    });

    it('rejette un IMO dont la somme de contrôle est fausse', () => {
        // 9424224 : dernier chiffre altéré — c'est la seule protection contre
        // une faute de frappe qui pointerait vers le navire d'un tiers.
        expect(normalizeVesselIdentifier('9424224')).toBeNull();
    });

    it('rejette toute longueur autre que 7 ou 9 chiffres', () => {
        for (const raw of ['', '123', '12345678', '1234567890', 'abcdefg']) {
            expect(normalizeVesselIdentifier(raw)).toBeNull();
        }
    });

    it('rejette une saisie sans aucun chiffre plutôt que de la réduire à vide', () => {
        expect(normalizeVesselIdentifier('IMO')).toBeNull();
    });
});

describe('classifyVesselIdentifier', () => {
    it('distingue une somme de contrôle IMO fausse d\'un problème de format', () => {
        // 9745311 : 7 chiffres, format correct, mais la clé de contrôle est
        // fausse (somme pondérée des 6 premiers chiffres = 156, clé attendue
        // 6, pas 1). C'est la faute de frappe qui a motivé ce correctif.
        expect(classifyVesselIdentifier('9745311')).toEqual({ ok: false, problem: 'IMO_CHECKSUM' });
    });

    it('accepte un IMO réel du jeu de données de seed', () => {
        expect(classifyVesselIdentifier('9235957')).toEqual({
            ok: true,
            identifier: { kind: 'IMO', value: '9235957' },
        });
    });

    it('accepte un MMSI à 9 chiffres', () => {
        expect(classifyVesselIdentifier('341581000')).toEqual({
            ok: true,
            identifier: { kind: 'MMSI', value: '341581000' },
        });
    });

    it('signale un problème de format pour une longueur ni 7 ni 9', () => {
        expect(classifyVesselIdentifier('123')).toEqual({ ok: false, problem: 'FORMAT' });
    });

    it('signale un problème de format pour une saisie vide', () => {
        expect(classifyVesselIdentifier('')).toEqual({ ok: false, problem: 'FORMAT' });
    });

    it('signale un problème de format pour une saisie sans aucun chiffre', () => {
        expect(classifyVesselIdentifier('IMO')).toEqual({ ok: false, problem: 'FORMAT' });
    });
});
