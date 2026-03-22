// ─────────────────────────────────────────────────────────────────────────────
// Africgreen — RBAC Permission Matrix (Demo Mode)
// Defines which sidebar nav items each role can see.
// ─────────────────────────────────────────────────────────────────────────────

import { UserRole } from '@/types/secure';

/**
 * Maps each nav key to the list of roles that can access it.
 * If a key is absent, it defaults to ALL roles (visible to everyone).
 *
 * RBAC Matrix:
 * ┌──────────────────┬──────────────┬──────────────┬───────────────┬──────────────┐
 * │ Page             │ PORT_OFFICER │ FINANCE_ADMIN│ SHIPPING_AGENT│ SUPERADMIN   │
 * ├──────────────────┼──────────────┼──────────────┼───────────────┼──────────────┤
 * │ map (Dashboard)  │ ✓            │ ✓            │ ✓             │ ✓            │
 * │ simulator        │ ✓            │ ✗            │ ✓             │ ✓            │
 * │ vessels          │ ✓            │ read         │ ✓ (own fleet) │ ✓            │
 * │ invoices         │ ✓            │ ✓            │ ✓ (own)       │ ✓            │
 * │ disputes         │ ✓            │ ✓            │ ✓             │ ✓            │
 * │ my-fleet         │ ✗            │ ✗            │ ✓             │ ✓            │
 * │ green-ledger     │ ✓            │ ✗            │ ✗             │ ✓            │
 * │ alerts           │ ✓            │ ✗            │ ✓             │ ✓            │
 * │ analytics        │ ✓            │ ✓            │ ✗             │ ✓            │
 * │ validations      │ ✓            │ ✗            │ ✗             │ ✓            │
 * │ tax-settings     │ ✗            │ ✓            │ ✗             │ ✓            │
 * │ revenue          │ ✗            │ ✓            │ ✗             │ ✓            │
 * │ settings         │ ✓            │ ✓            │ ✓             │ ✓            │
 * └──────────────────┴──────────────┴──────────────┴───────────────┴──────────────┘
 */
const NAV_PERMISSIONS: Record<string, UserRole[]> = {
    // Ops
    'map':          [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'simulator':    [UserRole.PORT_OFFICER, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'vessels':      [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'invoices':     [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'disputes':     [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'my-fleet':     [UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'tco':          [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'green-ledger': [UserRole.PORT_OFFICER, UserRole.SUPERADMIN],
    'alerts':       [UserRole.PORT_OFFICER, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'inspector':    [UserRole.PORT_OFFICER, UserRole.SUPERADMIN],
    'analytics':    [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],

    // Admin
    'validations':  [UserRole.PORT_OFFICER, UserRole.SUPERADMIN],
    'tax-settings': [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
    'revenue':      [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],

    // Settings — everyone
    'settings':     [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
};

/**
 * Check if a given role can access a specific nav item.
 */
export function canAccess(navKey: string, role: UserRole): boolean {
    const allowed = NAV_PERMISSIONS[navKey];
    if (!allowed) return true; // unknown key → allow by default
    return allowed.includes(role);
}

/**
 * Filter a list of nav items based on the user's role.
 */
export function filterNavItems<T extends { key: string }>(items: T[], role: UserRole): T[] {
    return items.filter((item) => canAccess(item.key, role));
}
