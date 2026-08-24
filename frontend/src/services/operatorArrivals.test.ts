import { describe, it, expect } from 'vitest';
import {
    imminenceOf, minutesToEta, sortByImminence,
    IMMINENT_MINUTES, SOON_HOURS, type OperatorArrival,
} from './operatorArrivals';

const NOW = new Date('2026-08-22T09:00:00Z');

const base: OperatorArrival = {
    alertId: 'a', vesselName: 'GULF EXPLORER', imoNumber: '9412887',
    minutesToEta: 40, etaIso: null, distanceNm: 12, imminence: 'now',
    ownerName: 'GULF MARITIME LTD', ownerOutstandingUsd: 128_400, ownerInDefault: true,
};

describe('minutesToEta', () => {
    it('compte les minutes restantes avant l’ETA', () => {
        expect(minutesToEta('2026-08-22T09:40:00Z', NOW)).toBe(40);
    });
    it('rend un négatif sur une ETA dépassée plutôt que de la masquer', () => {
        expect(minutesToEta('2026-08-22T08:30:00Z', NOW)).toBe(-30);
    });
    it('rend null sur une ETA absente ou illisible', () => {
        expect(minutesToEta(null, NOW)).toBeNull();
        expect(minutesToEta('bientôt', NOW)).toBeNull();
    });
});

describe('imminenceOf', () => {
    it('classe « maintenant » jusqu’au seuil de l’heure inclus', () => {
        expect(imminenceOf(IMMINENT_MINUTES)).toBe('now');
        expect(imminenceOf(IMMINENT_MINUTES + 1)).toBe('soon');
    });
    it('classe « bientôt » jusqu’au seuil des six heures inclus', () => {
        expect(imminenceOf(SOON_HOURS * 60)).toBe('soon');
        expect(imminenceOf(SOON_HOURS * 60 + 1)).toBe('later');
    });
    it('garde « maintenant » sur une ETA dépassée — le navire est déjà là', () => {
        expect(imminenceOf(-30)).toBe('now');
    });
    it('rend « inconnu » sans ETA', () => {
        expect(imminenceOf(null)).toBe('unknown');
    });
});

describe('sortByImminence', () => {
    it('met le plus imminent en tête, quel que soit son nom', () => {
        const rows = [
            { ...base, alertId: 'tomorrow', vesselName: 'AFRICA STAR', minutesToEta: 1180 },
            { ...base, alertId: 'now', vesselName: 'ZULU TRADER', minutesToEta: 40 },
            { ...base, alertId: 'soon', vesselName: 'BRAVO', minutesToEta: 180 },
        ];
        expect(sortByImminence(rows).map((r) => r.alertId)).toEqual(['now', 'soon', 'tomorrow']);
    });
    it('fait passer une ETA dépassée avant tout le reste', () => {
        const rows = [
            { ...base, alertId: 'upcoming', minutesToEta: 10 },
            { ...base, alertId: 'overdue', minutesToEta: -20 },
        ];
        expect(sortByImminence(rows).map((r) => r.alertId)).toEqual(['overdue', 'upcoming']);
    });
    it('renvoie les ETA inconnues en fin de liste, par distance croissante', () => {
        const rows = [
            { ...base, alertId: 'far', minutesToEta: null, distanceNm: 90 },
            { ...base, alertId: 'known', minutesToEta: 600 },
            { ...base, alertId: 'near', minutesToEta: null, distanceNm: 20 },
        ];
        expect(sortByImminence(rows).map((r) => r.alertId)).toEqual(['known', 'near', 'far']);
    });
    it('ne mute pas le tableau reçu', () => {
        const rows = [{ ...base, alertId: 'a', minutesToEta: 900 }, { ...base, alertId: 'b', minutesToEta: 10 }];
        sortByImminence(rows);
        expect(rows.map((r) => r.alertId)).toEqual(['a', 'b']);
    });
});
