'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { DashboardSidebar } from '@/components/dashboard/layout/DashboardSidebar';
import { DashboardTopBar } from '@/components/dashboard/layout/DashboardTopBar';
import { DashboardFooter } from '@/components/dashboard/layout/DashboardFooter';
import { useKpis } from '@/hooks/useKpis';
import { RoleProvider, useRole } from '@/lib/RoleContext';
import { SkinProvider } from '@/lib/SkinContext';
import { useNotifications } from '@/hooks/useNotifications';
import { canAccess } from '@/lib/rbac';
import { useRouter } from 'next/navigation';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { DemoBanner } from '@/components/ui/DemoBanner';


const SIDEBAR_COLLAPSED = 56;
const SIDEBAR_EXPANDED  = 220;

// Map pathname → sidebar active key + breadcrumb label
function resolveNav(pathname: string): { key: string; label: string } {
    if (pathname.startsWith('/dashboard/simulator'))   return { key: 'simulator',    label: 'Simulateur de Taxe Carbone' };
    if (pathname.startsWith('/dashboard/vessels'))     return { key: 'vessels',      label: 'Navires & Conformité' };
    if (pathname.startsWith('/dashboard/invoices'))    return { key: 'invoices',     label: 'Factures & Paiements' };
    if (pathname.startsWith('/dashboard/disputes'))    return { key: 'disputes',     label: 'Contestations' };
    if (pathname.startsWith('/dashboard/my-fleet'))    return { key: 'my-fleet',     label: 'Ma Flotte' };
    if (pathname.startsWith('/dashboard/tco'))         return { key: 'tco',          label: 'Co\u00fbt Total (TCO)' };
    if (pathname.startsWith('/dashboard/inspector'))    return { key: 'inspector',    label: 'Inspections Terrain' };
    if (pathname.startsWith('/dashboard/projects'))    return { key: 'green-ledger', label: 'Green Ledger' };
    if (pathname.startsWith('/dashboard/alerts'))      return { key: 'alerts',       label: 'Alertes & Exceptions' };
    if (pathname.startsWith('/dashboard/reports'))     return { key: 'analytics',    label: 'Analytics & Rapports' };
    if (pathname.startsWith('/dashboard/audit'))       return { key: 'audit',        label: 'Audit Trail' };
    if (pathname.startsWith('/dashboard/validations')) return { key: 'validations',  label: 'Validation des agents' };
    if (pathname.startsWith('/dashboard/settings'))    return { key: 'settings',     label: 'Paramètres' };
    if (pathname.startsWith('/admin/tax-settings'))    return { key: 'tax-settings', label: 'Taxe carbone — Paramètres' };
    if (pathname.startsWith('/admin/revenue'))         return { key: 'revenue',      label: 'Tableau des recettes' };
    if (pathname.startsWith('/admin'))                 return { key: 'tax-settings', label: 'Console Admin' };
    return { key: 'map', label: 'Command Center — The Eye of Berbera' };
}





// ── Skin bridge — wraps inner layout with SkinProvider using resolved role ────

function SkinBridge({ children }: { children: React.ReactNode }) {
    const { role } = useRole();
    return <SkinProvider defaultRole={role}>{children}</SkinProvider>;
}

// ── Inner layout (uses RoleContext) ───────────────────────────────────────────

function DashboardInner({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { key, label } = resolveNav(pathname);
    const { user, role, isDemo } = useRole();
    const { data: kpis } = useKpis();

    const { notifications, pendingRegistrations, unreadCount, markRead, markAllRead } = useNotifications();

    // Route eviction check based on RBAC
    React.useEffect(() => {
        if (!isDemo && role && !canAccess(key, role)) {
            console.warn(`Unauthorized access attempt to ${key} by role ${role}`);
            router.replace('/dashboard/vessels');
        }
    }, [role, key, router, isDemo]);

    // Fast-fail rendering to avoid info flashes
    const hasAccess = isDemo || (role && canAccess(key, role));


    // Persist sidebar state across navigations
    const [expanded, setExpanded] = React.useState(false);
    const [mobileOpen, setMobileOpen] = React.useState(false);

    React.useEffect(() => {
        const saved = localStorage.getItem('sidebar_expanded');
        if (saved === 'true') setExpanded(true);
    }, []);

    // Close mobile sidebar on route change
    React.useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    function toggleSidebar() {
        setExpanded((prev) => {
            const next = !prev;
            localStorage.setItem('sidebar_expanded', String(next));
            return next;
        });
    }

    const sidebarW = expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED;

    return (
        <div
            style={{
                backgroundColor: 'var(--os-bg)',
                color: 'var(--os-text-primary)',
                minHeight: '100vh',
                '--os-sidebar-w': `${sidebarW}px`,
            } as React.CSSProperties}
        >
            <DashboardSidebar
                activePage={key}
                expanded={expanded}
                onToggle={toggleSidebar}
                pendingRegistrations={pendingRegistrations}
                mobileOpen={mobileOpen}
                onMobileClose={() => setMobileOpen(false)}
            />
            <DashboardTopBar
                user={user}
                kpis={kpis}
                breadcrumb={label}
                notifications={notifications}
                unreadCount={unreadCount}
                onMarkRead={markRead}
                onMarkAllRead={markAllRead}
                onMobileMenuToggle={() => setMobileOpen((v) => !v)}
            />

            <main
                className="md:ml-[var(--os-sidebar-w)]"
                style={{
                    paddingTop: '3.5rem',
                    paddingBottom: '2rem',
                    minHeight: '100vh',
                    transition: 'margin-left 220ms cubic-bezier(0.4,0,0.2,1)',
                }}
            >
                {hasAccess ? children : (
                    <div className="flex items-center justify-center min-h-[50vh]">
                        <p className="text-sm font-medium opacity-50">Accès Refusé. Redirection en cours...</p>
                    </div>
                )}
            </main>

            <DashboardFooter />
            {isDemo && <DemoBanner />}
            <OfflineBanner />

        </div>
    );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <RoleProvider>
            <SkinBridge>
                <DashboardInner>{children}</DashboardInner>
            </SkinBridge>
        </RoleProvider>
    );
}
