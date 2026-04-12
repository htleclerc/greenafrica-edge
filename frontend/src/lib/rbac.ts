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
 * │ tax-settings     │ read         │ ✓            │ ✗             │ ✓            │
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

    // Audit
    'audit':        [UserRole.PORT_OFFICER, UserRole.SUPERADMIN],

    // Admin
    'validations':  [UserRole.PORT_OFFICER, UserRole.SUPERADMIN],
    'tax-settings': [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
    'revenue':      [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],

    // Settings — everyone
    'settings':     [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
};

/**
 * Pages where some roles get READ-ONLY access (visible in the menu and
 * navigable, but cannot perform write actions like Edit/Add/Save/Delete).
 *
 * Used by pages to gate their action buttons. Defaults to "everyone in
 * NAV_PERMISSIONS can edit" — only listed roles get the read-only treatment.
 */
const READ_ONLY_ROLES: Record<string, UserRole[]> = {
    'tax-settings': [UserRole.PORT_OFFICER],  // PORT_OFFICER reads, cannot modify rates/exemptions
    'revenue':      [UserRole.PORT_OFFICER],  // same posture for revenue dashboard
};

/**
 * Check if a given role can access a specific nav item (read or write).
 */
export function canAccess(navKey: string, role: UserRole): boolean {
    const allowed = NAV_PERMISSIONS[navKey];
    if (!allowed) return true; // unknown key → allow by default
    return allowed.includes(role);
}

/**
 * Check if a given role can perform write actions on a specific nav item.
 * Returns false for roles that have read-only access.
 */
export function canEdit(navKey: string, role: UserRole): boolean {
    if (!canAccess(navKey, role)) return false;
    const readOnlyRoles = READ_ONLY_ROLES[navKey];
    if (!readOnlyRoles) return true;
    return !readOnlyRoles.includes(role);
}

/**
 * Filter a list of nav items based on the user's role.
 */
export function filterNavItems<T extends { key: string }>(items: T[], role: UserRole): T[] {
    return items.filter((item) => canAccess(item.key, role));
}
