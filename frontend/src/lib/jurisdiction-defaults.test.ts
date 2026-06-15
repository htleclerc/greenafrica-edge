import { describe, it, expect } from 'vitest';
import { getJurisdictionDefaults } from './jurisdiction-defaults';
import { OperationalSite } from '@/types/secure';

describe('getJurisdictionDefaults', () => {
    it('returns Djibouti defaults for the DJ jurisdiction UUID', () => {
        const result = getJurisdictionDefaults('00000000-0000-4000-8000-00000000444a');
        expect(result.defaultSite).toBe(OperationalSite.DJIBOUTI_PORT);
        expect(result.defaultTimezone).toBe('Africa/Djibouti');
    });

    it('returns Somaliland defaults for the SO jurisdiction UUID', () => {
        const result = getJurisdictionDefaults('00000000-0000-4000-8000-00000000534f');
        expect(result.defaultSite).toBe(OperationalSite.BERBERA_PORT);
        expect(result.defaultTimezone).toBe('Africa/Mogadishu');
    });

    it('returns Somaliland defaults for an unknown jurisdiction UUID', () => {
        const result = getJurisdictionDefaults('ffffffff-ffff-4fff-8fff-ffffffffffff');
        expect(result.defaultSite).toBe(OperationalSite.BERBERA_PORT);
        expect(result.defaultTimezone).toBe('Africa/Mogadishu');
    });

    it('returns Somaliland defaults for an empty string', () => {
        const result = getJurisdictionDefaults('');
        expect(result.defaultSite).toBe(OperationalSite.BERBERA_PORT);
        expect(result.defaultTimezone).toBe('Africa/Mogadishu');
    });
});
