import { describe, it, expect } from 'vitest';
import {
    mergeReadIds, applyReadState, parseReadIds, MAX_REMEMBERED,
} from './notificationReadState';

describe('mergeReadIds', () => {
    it('ajoute les nouveaux identifiants sans perdre les anciens', () => {
        expect(mergeReadIds(['a', 'b'], ['c'])).toEqual(['c', 'a', 'b']);
    });
    it('ne garde qu’une occurrence d’un identifiant déjà connu', () => {
        expect(mergeReadIds(['a', 'b'], ['b'])).toEqual(['b', 'a']);
    });
    it('ignore les identifiants vides', () => {
        expect(mergeReadIds(['a'], ['', 'b'])).toEqual(['b', 'a']);
    });
    it('plafonne la liste en sacrifiant les plus anciens', () => {
        const existing = Array.from({ length: 5 }, (_, i) => `old-${i}`);
        expect(mergeReadIds(existing, ['new'], 3)).toEqual(['new', 'old-0', 'old-1']);
    });
    it('a un plafond par défaut, pour ne pas enfler indéfiniment', () => {
        const existing = Array.from({ length: MAX_REMEMBERED + 50 }, (_, i) => `id-${i}`);
        expect(mergeReadIds(existing, [])).toHaveLength(MAX_REMEMBERED);
    });
});

describe('applyReadState', () => {
    const items = [
        { id: 'a', read: false },
        { id: 'b', read: false },
    ];

    // C'est le coeur du correctif : sans ce report, chaque recalcul rendait
    // toutes les notifications non lues au bout de soixante secondes.
    it('repose le drapeau lu sur des éléments fraîchement recalculés', () => {
        expect(applyReadState(items, new Set(['a']))).toEqual([
            { id: 'a', read: true },
            { id: 'b', read: false },
        ]);
    });
    it('ne remet jamais un élément en non lu', () => {
        const alreadyRead = [{ id: 'a', read: true }];
        expect(applyReadState(alreadyRead, new Set())).toEqual([{ id: 'a', read: true }]);
    });
    it('ne mute pas les éléments reçus', () => {
        applyReadState(items, new Set(['a']));
        expect(items[0].read).toBe(false);
    });
});

describe('parseReadIds', () => {
    it('lit une liste d’identifiants', () => {
        expect(parseReadIds('["a","b"]')).toEqual(['a', 'b']);
    });
    it('rend une liste vide plutôt que de lever sur du contenu abîmé', () => {
        expect(parseReadIds(null)).toEqual([]);
        expect(parseReadIds('pas du json')).toEqual([]);
        expect(parseReadIds('{"a":1}')).toEqual([]);
    });
    it('écarte les entrées qui ne sont pas des chaînes', () => {
        expect(parseReadIds('["a",42,null,"b"]')).toEqual(['a', 'b']);
    });
});
