import { OperationalSite } from '@/types/secure';

/** UUID of the Djibouti jurisdiction (mig 080 seed). */
const DJ_JURISDICTION_ID = '00000000-0000-4000-8000-00000000444a';

export interface JurisdictionDefaults {
    defaultSite: OperationalSite;
    defaultTimezone: string;
}

/**
 * Return the default operational site and timezone for a jurisdiction,
 * keyed by its UUID.
 *
 * Used at account-creation time to stamp profiles.operational_site and
 * profiles.timezone without hardcoding Somaliland values everywhere.
 *
 * Add a new branch here whenever a new jurisdiction is onboarded.
 */
export function getJurisdictionDefaults(jurisdictionId: string): JurisdictionDefaults {
    if (jurisdictionId === DJ_JURISDICTION_ID) {
        return {
            defaultSite: OperationalSite.DJIBOUTI_PORT,
            defaultTimezone: 'Africa/Djibouti',
        };
    }
    // Default: Somaliland (covers SO jurisdiction UUID + any unknown/future IDs
    // until they receive their own branch).
    return {
        defaultSite: OperationalSite.BERBERA_PORT,
        defaultTimezone: 'Africa/Mogadishu',
    };
}
