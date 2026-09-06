import { describe, it, expect } from 'vitest';
import { ALL_PIPELINE_KEYS, PIPELINE_KEYS_BY_TAB, SETTINGS_TABS, parseSettingsTab } from './settingsTabs';
import { PIPELINE_KEY_ORDER } from '@/components/dashboard/tax/CarbonTaxPipelineSection';

describe('settingsTabs', () => {
    it("chaque clé de l'éditeur a UN volet, et un seul", () => {
        // Une clé sans volet disparaîtrait de l'écran ; une clé dans deux volets
        // s'éditerait à deux endroits.
        const sorted = [...ALL_PIPELINE_KEYS].sort();
        expect(sorted).toEqual([...PIPELINE_KEY_ORDER].sort());
        expect(new Set(ALL_PIPELINE_KEYS).size).toBe(ALL_PIPELINE_KEYS.length);
    });

    it('les secrets et la plomberie sont dans Système', () => {
        expect(PIPELINE_KEYS_BY_TAB.systeme).toContain('queue.worker_secret');
        for (const tab of SETTINGS_TABS.filter((t) => t !== 'systeme')) {
            expect(PIPELINE_KEYS_BY_TAB[tab].some((k) => k.startsWith('queue.'))).toBe(false);
        }
    });

    it('retombe sur Fiscalité pour un volet inconnu', () => {
        expect(parseSettingsTab('portail')).toBe('portail');
        expect(parseSettingsTab('nope')).toBe('fiscalite');
        expect(parseSettingsTab(undefined)).toBe('fiscalite');
    });
});
