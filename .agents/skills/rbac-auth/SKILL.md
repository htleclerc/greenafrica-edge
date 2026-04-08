# RBAC & Auth Specialist

## Trigger
When working on authentication, role-based access, permissions, login, post-login, or route protection.

## Context
- RBAC logic: `frontend/src/lib/rbac.ts` — canAccess(), filterNavItems(), NAV_PERMISSIONS
- Types: `UserRole` enum in `frontend/src/types/secure/index.ts`
- Login page: `frontend/src/components/auth/LoginPage.tsx`
- Post-login: `frontend/src/components/auth/PostLoginPage.tsx`
- Sidebar: `frontend/src/components/dashboard/layout/DashboardSidebar.tsx`
- Test profiles: `frontend/src/mock/datas/testProfiles.ts`

## 8 Roles
**Port Authority**: PORT_OFFICER, FINANCE_ADMIN, COMPLIANCE_AUDITOR
**Shipping**: SHIPPING_AGENT, FLEET_MANAGER, FINANCE_CONTACT, LEGAL_REP
**System**: SUPERADMIN

## Auth Flow
```
/login → /post-login (role selection) → /dashboard
```

## Helper Functions
- `isShipRole(role)` — true for SHIPPING_AGENT, FLEET_MANAGER, FINANCE_CONTACT, LEGAL_REP
- `isPortRole(role)` — true for PORT_OFFICER, FINANCE_ADMIN, COMPLIANCE_AUDITOR
- `canAccess(role, navKey)` — checks NAV_PERMISSIONS matrix
- `filterNavItems(role, items)` — filters sidebar items by role

## Rules
1. Always use `canAccess()` or `filterNavItems()` — never check roles manually
2. New pages MUST be added to NAV_PERMISSIONS with appropriate roles
3. Unknown nav keys default to ALLOW — this is intentional for public pages
4. SUPERADMIN has access to everything
5. Role context is provided via RoleContext throughout the app
6. After modifying rbac.ts, verify the sidebar still renders correctly for each role
