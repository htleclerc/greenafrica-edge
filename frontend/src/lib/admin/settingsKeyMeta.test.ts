import { describe, it, expect } from 'vitest';
import { checkBounds, keyMeta, SETTINGS_KEY_META } from './settingsKeyMeta';
import { PIPELINE_KEYS_BY_TAB } from './settingsTabs';

describe('settingsKeyMeta', () => {
    it('arrête une faute de frappe, pas une décision', () => {
        expect(checkBounds('arrival.corridor_radius_nm', 25)).toEqual({ ok: true });
        expect(checkBounds('arrival.corridor_radius_nm', 500)).toEqual({ ok: false, reason: 'max', bound: 200 });
        expect(checkBounds('reconciliation.tolerance_pct', -1)).toEqual({ ok: false, reason: 'min', bound: 0 });
    });

    it('exige un entier là où un demi-rappel n’a pas de sens', () => {
        expect(checkBounds('owner_escalation.reminder_count', 2.5)).toEqual({ ok: false, reason: 'integer' });
        expect(checkBounds('owner_escalation.reminder_count', 3)).toEqual({ ok: true });
    });

    it('laisse passer une clé sans bornes', () => {
        expect(checkBounds('feature.ais_global_enabled', 12345)).toEqual({ ok: true });
        expect(keyMeta('unknown.key')).toEqual({});
    });

    it('les clés dangereuses sont toutes dans le volet Système', () => {
        const dangerous = Object.entries(SETTINGS_KEY_META).filter(([, m]) => m.danger).map(([k]) => k);
        for (const k of dangerous) expect(PIPELINE_KEYS_BY_TAB.systeme).toContain(k);
    });
});
