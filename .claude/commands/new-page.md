Create a new dashboard page at frontend/src/app/(dashboard)/$ARGUMENTS/page.tsx.

Requirements:
1. Use "use client" directive
2. Import useTranslations from next-intl
3. Wrap content in OsCard component from @/components/ui/OsCard
4. Add the page's nav key to NAV_PERMISSIONS in frontend/src/lib/rbac.ts with appropriate role access
5. Add i18n keys to ALL 5 locale files (en.json, fr.json, ar.json, pt.json, sw.json) in frontend/messages/
6. Add a navigation entry to DashboardSidebar.tsx if appropriate
7. Follow the existing pattern from DisputesPage.tsx or InvoicesPage.tsx as reference

Before creating, read:
- frontend/src/components/dashboard/disputes/DisputesPage.tsx (for component pattern)
- frontend/src/lib/rbac.ts (for RBAC integration)
- frontend/src/components/dashboard/layout/DashboardSidebar.tsx (for nav entry)
