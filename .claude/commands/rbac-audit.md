Audit the RBAC system for consistency across routes, permissions, and navigation.

Steps:
1. Read frontend/src/lib/rbac.ts — extract all nav keys and their allowed roles from NAV_PERMISSIONS
2. List all page routes in frontend/src/app/(dashboard)/ recursively
3. Read frontend/src/components/dashboard/layout/DashboardSidebar.tsx — extract all sidebar nav items and their keys
4. Cross-reference and report:
   - Dashboard routes WITHOUT a corresponding RBAC entry in NAV_PERMISSIONS
   - RBAC entries WITHOUT a corresponding dashboard route
   - Sidebar nav items WITHOUT a matching RBAC entry
   - RBAC entries NOT referenced in the sidebar (may be intentional for sub-pages)
5. For each role (PORT_OFFICER, FINANCE_ADMIN, COMPLIANCE_AUDITOR, SHIPPING_AGENT, FLEET_MANAGER, FINANCE_CONTACT, LEGAL_REP, SUPERADMIN):
   - List which pages they can access
   - Flag any role with no accessible pages or with access to everything

Do NOT modify any files — only report findings.
