// ─────────────────────────────────────────────────────────────────────────────
// Green Gate — RBAC Permission Matrix
// Defines which sidebar nav items each role can see.
// ─────────────────────────────────────────────────────────────────────────────

import { UserRole } from '@/types/secure';

/**
 * Maps each nav key to the list of roles that can access it.
 *
 * RBAC Matrix (post-migration 020 with MANAGER):
 * ┌──────────────────┬──────────────┬──────────────┬───────────────┬──────────────┬──────────┐
 * │ Page             │ PORT_OFFICER │ FINANCE_ADMIN│ SHIPPING_AGENT│ SUPERADMIN   │ MANAGER  │
 * ├──────────────────┼──────────────┼──────────────┼───────────────┼──────────────┼──────────┤
 * │ map (Dashboard)  │ ✓            │ ✓            │ ✓             │ ✓            │ ✓        │
 * │ simulator        │ ✓            │ ✗            │ ✓             │ ✓            │ ✓        │
 * │ vessels          │ ✓            │ read         │ ✓ (own fleet) │ ✓            │ ✓        │
 * │ invoices         │ ✓            │ ✓            │ ✓ (own)       │ ✓            │ read     │
 * │ disputes         │ ✓            │ ✓            │ ✓             │ ✓            │ read     │
 * │ my-fleet         │ ✗            │ ✗            │ ✓             │ ✓            │ ✗        │
 * │ green-ledger     │ ✓            │ ✗            │ ✗             │ ✓            │ ✗        │
 * │ alerts           │ ✓            │ ✗            │ ✓             │ ✓            │ ✓        │
 * │ analytics        │ ✓            │ ✓            │ ✗             │ ✓            │ ✗        │
 * │ validations      │ ✓            │ ✗            │ ✗             │ ✓            │ ✓        │
 * │ inspector        │ ✓            │ ✗            │ ✗             │ ✓            │ ✓        │
 * │ audit            │ ✓            │ ✗            │ ✗             │ ✓            │ read     │
 * ├──── money rail ──┼──────────────┼──────────────┼───────────────┼──────────────┼──────────┤
 * │ tax-settings     │ read         │ ✓            │ ✗             │ ✓            │ ✗        │
 * │ origin-port-prop │ ✓            │ ✓            │ ✗             │ ✓            │ ✗        │
 * │ revenue          │ ✗            │ ✓            │ ✗             │ ✓            │ ✗        │
 * │ payments         │ ✗            │ ✓            │ ✗             │ ✓            │ ✗        │
 * ├──────────────────┼──────────────┼──────────────┼───────────────┼──────────────┼──────────┤
 * │ settings         │ ✓            │ ✓            │ ✓             │ ✓            │ ✓        │
 * └──────────────────┴──────────────┴──────────────┴───────────────┴──────────────┴──────────┘
 *
 * MANAGER principle: "no money, no RBAC" — runs daily ops, never touches
 * money-rail or user/role administration.
 */
const NAV_PERMISSIONS: Record<string, UserRole[]> = {
    // Ops
    'map':          [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN, UserRole.MANAGER],
    'simulator':    [UserRole.PORT_OFFICER, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN, UserRole.MANAGER],
    'vessels':      [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN, UserRole.MANAGER],
    'invoices':     [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN, UserRole.MANAGER],
    'disputes':     [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN, UserRole.MANAGER],
    'my-fleet':     [UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'tco':          [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN, UserRole.MANAGER],
    'green-ledger': [UserRole.PORT_OFFICER, UserRole.SUPERADMIN],
    'alerts':       [UserRole.PORT_OFFICER, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN, UserRole.MANAGER],
    'inspector':    [UserRole.PORT_OFFICER, UserRole.SUPERADMIN, UserRole.MANAGER],
    'analytics':    [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],

    // Audit
    'audit':        [UserRole.PORT_OFFICER, UserRole.SUPERADMIN, UserRole.MANAGER],

    // Admin (ops side — MANAGER allowed)
    'validations':  [UserRole.PORT_OFFICER, UserRole.SUPERADMIN, UserRole.MANAGER],
    'registrations': [UserRole.PORT_OFFICER, UserRole.SUPERADMIN, UserRole.MANAGER],

    // Money rail (MANAGER explicitly excluded — see MONEY_RAIL_KEYS below)
    'tax-settings': [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
    'origin-port-proposals': [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
    'revenue':      [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
    'payments':     [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
    'refunds':      [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
    'cash-desk':    [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN, UserRole.PORT_OFFICER],
    'wallets':      [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN, UserRole.MANAGER],
    'jurisdictions': [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN, UserRole.PORT_OFFICER],

    // Settings — everyone
    'settings':     [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN, UserRole.MANAGER],
};

/**
 * Money-rail keys — used to enforce deny-by-default for unknown keys
 * AND as the canonical list of routes that need server-side requireRole()
 * enforcement.
 *
 * If a new money-touching feature is added, list its nav key here so the
 * unknown-key fallback in canAccess() will deny it for any role that hasn't
 * explicitly been granted access in NAV_PERMISSIONS.
 */
export const MONEY_RAIL_KEYS = new Set<string>([
    'tax-settings',
    'revenue',
    'payments',
    'refunds',
    'cash-desk',
    'wallet-topups',
    'wallet-audit',
    'mark-paid',
]);

/**
 * Pages where some roles get READ-ONLY access (visible in the menu and
 * navigable, but cannot perform write actions like Edit/Add/Save/Delete).
 *
 * Used by pages to gate their action buttons. Defaults to "everyone in
 * NAV_PERMISSIONS can edit" — only listed roles get the read-only treatment.
 */
const READ_ONLY_ROLES: Record<string, UserRole[]> = {
    'tax-settings': [UserRole.PORT_OFFICER],   // PORT_OFFICER reads, cannot modify rates/exemptions
    'revenue':      [UserRole.PORT_OFFICER],   // same posture for revenue dashboard
    'invoices':     [UserRole.MANAGER],        // MANAGER reads invoices, no issuance
    'disputes':     [UserRole.MANAGER],        // MANAGER reads disputes; resolve = money action, denied
    'audit':        [UserRole.MANAGER],        // MANAGER reads audit, never writes
    'registrations': [UserRole.PORT_OFFICER],  // PORT_OFFICER reads registrations, actions require MANAGER role
};

/**
 * Check if a given role can access a specific nav item (read or write).
 *
 * Default for unknown keys:
 *   - SUPERADMIN: allowed (escape hatch for fast iteration)
 *   - All others: DENIED (deny-by-default)
 *
 * Previously this returned `true` for unknown keys (fail-open). That made
 * adding a new money-rail nav key without updating NAV_PERMISSIONS silently
 * grant access to every role. Now any new key must be explicitly listed.
 */
export function canAccess(navKey: string, role: UserRole): boolean {
    const allowed = NAV_PERMISSIONS[navKey];
    if (!allowed) {
        // Deny-by-default for unknown keys, except SUPERADMIN.
        return role === UserRole.SUPERADMIN;
    }
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

/**
 * Cash Desk access — two-layer gate (Plan 7C-4):
 *   1. Role: FINANCE_ADMIN, SUPERADMIN always allowed.
 *   2. PORT_OFFICER allowed iff `profiles.can_record_cash = true` (mig 061).
 *
 * Used by `/admin/cash-desk` page-level redirect AND (where the profile flag
 * is in scope) sidebar visibility. The sidebar without profile context can
 * fall back to {@link canAccess}('cash-desk', role) — PORT_OFFICERs without
 * the flag will then see the link and be redirected by the page guard.
 */
export function canAccessCashDesk(
    role: UserRole | string | null | undefined,
    canRecordCashFlag: boolean,
): boolean {
    if (role === UserRole.SUPERADMIN || role === UserRole.FINANCE_ADMIN) return true;
    if (role === UserRole.PORT_OFFICER) return canRecordCashFlag === true;
    return false;
}
