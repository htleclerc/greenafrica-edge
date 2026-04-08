// ─────────────────────────────────────────────────────────────────────────────
// Africgreen — RBAC Permission Matrix (Demo Mode)
// Defines which sidebar nav items each role can see.
// ─────────────────────────────────────────────────────────────────────────────

import { UserRole } from '@/types/secure';

// ── Role groups (for readability) ────────────────────────────────────────────

/** All port-authority side roles */
const PORT_ROLES = [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.COMPLIANCE_AUDITOR];

/** All armateur/shipping side roles */
const SHIP_ROLES = [UserRole.SHIPPING_AGENT, UserRole.FLEET_MANAGER, UserRole.FINANCE_CONTACT, UserRole.LEGAL_REP];

/** Every role in the system */
const ALL_ROLES = [...PORT_ROLES, ...SHIP_ROLES, UserRole.SUPERADMIN];

/**
 * RBAC Matrix:
 * ┌──────────────────┬──────────┬─────────────┬──────────────────┬───────────────┬──────────────┬─────────────────┬───────────┬───────────┐
 * │ Page             │ PORT_OFF │ FINANCE_ADM │ COMPLIANCE_AUD   │ FLEET_MGR     │ FINANCE_CON  │ LEGAL_REP       │ SHIP_AGT  │ SUPERADM  │
 * ├──────────────────┼──────────┼─────────────┼──────────────────┼───────────────┼──────────────┼─────────────────┼───────────┼───────────┤
 * │ map (Dashboard)  │ ✓        │ ✓           │ ✓                │ ✓             │ ✓            │ ✓               │ ✓         │ ✓         │
 * │ simulator        │ ✓        │ ✗           │ ✗                │ ✓             │ ✗            │ ✗               │ ✓         │ ✓         │
 * │ vessels          │ ✓        │ read        │ ✓ (audit)        │ ✓ (own fleet) │ read         │ read            │ ✓         │ ✓         │
 * │ invoices         │ ✓        │ ✓           │ read             │ read          │ ✓ (own)      │ read            │ ✓         │ ✓         │
 * │ disputes         │ ✓        │ ✓           │ ✓                │ ✗             │ ✗            │ ✓               │ ✓         │ ✓         │
 * │ my-fleet         │ ✗        │ ✗           │ ✗                │ ✓             │ ✓            │ ✓               │ ✓         │ ✓         │
 * │ tco              │ ✓        │ ✓           │ ✗                │ ✓             │ ✓            │ ✗               │ ✓         │ ✓         │
 * │ green-ledger     │ ✓        │ ✗           │ ✓                │ ✗             │ ✗            │ ✗               │ ✗         │ ✓         │
 * │ alerts           │ ✓        │ ✗           │ ✓                │ ✓             │ ✓            │ ✓               │ ✓         │ ✓         │
 * │ inspector        │ ✓        │ ✗           │ ✓                │ ✗             │ ✗            │ ✗               │ ✗         │ ✓         │
 * │ analytics        │ ✓        │ ✓           │ ✓                │ ✗             │ ✗            │ ✗               │ ✗         │ ✓         │
 * │ validations      │ ✓        │ ✗           │ ✗                │ ✗             │ ✗            │ ✗               │ ✗         │ ✓         │
 * │ tax-settings     │ ✗        │ ✓           │ ✗                │ ✗             │ ✗            │ ✗               │ ✗         │ ✓         │
 * │ revenue          │ ✗        │ ✓           │ ✗                │ ✗             │ ✗            │ ✗               │ ✗         │ ✓         │
 * │ settings         │ ✓        │ ✓           │ ✓                │ ✓             │ ✓            │ ✓               │ ✓         │ ✓         │
 * └──────────────────┴──────────┴─────────────┴──────────────────┴───────────────┴──────────────┴─────────────────┴───────────┴───────────┘
 */
const NAV_PERMISSIONS: Record<string, UserRole[]> = {
    // Ops — everyone sees the map and settings
    'map':          ALL_ROLES,
    'simulator':    [UserRole.PORT_OFFICER, UserRole.FLEET_MANAGER, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'vessels':      ALL_ROLES,
    'invoices':     ALL_ROLES,
    'disputes':     [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.COMPLIANCE_AUDITOR, UserRole.LEGAL_REP, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'my-fleet':     [UserRole.FLEET_MANAGER, UserRole.FINANCE_CONTACT, UserRole.LEGAL_REP, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'tco':          [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.FLEET_MANAGER, UserRole.FINANCE_CONTACT, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN],
    'green-ledger': [UserRole.PORT_OFFICER, UserRole.COMPLIANCE_AUDITOR, UserRole.SUPERADMIN],
    'alerts':       [UserRole.PORT_OFFICER, UserRole.COMPLIANCE_AUDITOR, ...SHIP_ROLES, UserRole.SUPERADMIN],
    'inspector':    [UserRole.PORT_OFFICER, UserRole.COMPLIANCE_AUDITOR, UserRole.SUPERADMIN],
    'analytics':    [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.COMPLIANCE_AUDITOR, UserRole.SUPERADMIN],

    // Audit trail — compliance-focused
    'audit':        [UserRole.PORT_OFFICER, UserRole.COMPLIANCE_AUDITOR, UserRole.SUPERADMIN],

    // Admin
    'validations':  [UserRole.PORT_OFFICER, UserRole.SUPERADMIN],
    'tax-settings': [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
    'revenue':      [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],

    // Settings — everyone
    'settings':     ALL_ROLES,
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
