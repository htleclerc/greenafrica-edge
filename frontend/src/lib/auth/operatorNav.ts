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
