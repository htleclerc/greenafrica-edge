// Ordered navigation items for the operator (shipowner/air operator) shell.
//
// Used by DashboardSidebar to render a flat 8-item nav when the current
// principal is an operator.  Staff get the existing RBAC-filtered nav;
// operators get this list directly — no filterNavItems, no JurisdictionSwitcher.
//
// labelKey values are translation keys scoped under the 'OwnerPortal' namespace,
// consumed via useTranslations('OwnerPortal') → t(item.labelKey).
// Full message path: OwnerPortal.<labelKey>  (e.g. OwnerPortal.nav.dashboard)

export interface OperatorNavItem {
    key: string;
    href: string;
    labelKey: string;
}

export type OperatorMode = 'MARITIME' | 'AIR';

/**
 * Picks the label key for the "vessels" nav entry based on the operator's modes:
 *   - AIR only            → nav.aircraft
 *   - both MARITIME + AIR → nav.fleet
 *   - MARITIME / unknown  → nav.vessels (default, backwards compatible)
 */
export function vesselsNavLabelKey(modes: OperatorMode[]): string {
    const hasAir = modes.includes('AIR');
    const hasMaritime = modes.includes('MARITIME');
    if (hasAir && !hasMaritime) return 'nav.aircraft';
    if (hasAir && hasMaritime) return 'nav.fleet';
    return 'nav.vessels';
}

/** True when the operator flies only — used to swap the Ship icon for a Plane. */
export function isAirOnly(modes: OperatorMode[]): boolean {
    return modes.includes('AIR') && !modes.includes('MARITIME');
}

export const OPERATOR_NAV: OperatorNavItem[] = [
    { key: 'dashboard',     href: '/dashboard',               labelKey: 'nav.dashboard' },
    { key: 'vessels',       href: '/dashboard/vessels',       labelKey: 'nav.vessels' },
    { key: 'invoices',      href: '/dashboard/invoices',      labelKey: 'nav.invoices' },
    { key: 'wallet',        href: '/dashboard/wallet',        labelKey: 'nav.wallet' },
    { key: 'simulator',     href: '/dashboard/simulator',     labelKey: 'nav.simulator' },
    { key: 'tco',           href: '/dashboard/tco',           labelKey: 'nav.tco' },
    { key: 'disputes',      href: '/dashboard/disputes',      labelKey: 'nav.disputes' },
    { key: 'notifications', href: '/dashboard/notifications', labelKey: 'nav.notifications' },
];
