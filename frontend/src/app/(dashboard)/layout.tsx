'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { DashboardSidebar } from '@/components/dashboard/layout/DashboardSidebar';
import { DashboardTopBar } from '@/components/dashboard/layout/DashboardTopBar';
import { DashboardFooter } from '@/components/dashboard/layout/DashboardFooter';
import { useKpis } from '@/hooks/useKpis';
import { DEMO_PROFILES } from '@/mock/datas/testProfiles';
import { Zap, X } from 'lucide-react';
import { RoleProvider, useRole } from '@/lib/RoleContext';
import { SkinProvider } from '@/lib/SkinContext';
import { useNotifications } from '@/hooks/useNotifications';
import { OfflineBanner } from '@/components/ui/OfflineBanner';

const SIDEBAR_COLLAPSED = 56;
const SIDEBAR_EXPANDED  = 220;

// Map pathname → sidebar active key + breadcrumb label
function resolveNav(pathname: string): { key: string; label: string } {
    if (pathname.startsWith('/dashboard/simulator'))   return { key: 'simulator',    label: 'Simulateur de Taxe Carbone' };
    if (pathname.startsWith('/dashboard/vessels'))     return { key: 'vessels',      label: 'Navires & Conformité' };
    if (pathname.startsWith('/dashboard/invoices'))    return { key: 'invoices',     label: 'Factures & Paiements' };
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

// ── Demo banner ───────────────────────────────────────────────────────────────

function DemoBanner() {
    const { role, isDemo } = useRole();
    const [dismissed, setDismissed] = React.useState(false);

    function exitDemo() {
        document.cookie = 'demo_active=; path=/; max-age=0';
        document.cookie = 'demo_role=; path=/; max-age=0';
        localStorage.removeItem('demo_active');
        localStorage.removeItem('demo_role');
        window.location.href = '/login';
    }

    if (!isDemo || dismissed) return null;

    const profile = DEMO_PROFILES.find((p) => p.role === role);
    if (!profile) return null;

    return (
        <div
            className="fixed top-0 right-0 z-[60] flex items-center justify-between px-2 sm:px-4 py-2 text-[10px] sm:text-xs font-semibold left-0 md:left-[var(--os-sidebar-w)]"
            style={{
                backgroundColor: '#EAB308',
                color: '#000',
                transition: 'left 220ms cubic-bezier(0.4,0,0.2,1)',
            }}
        >
            <div className="flex items-center gap-2 min-w-0">
                <Zap className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">MODE DÉMO — {profile.label}</span>
                <span className="opacity-60 font-normal hidden sm:inline">· Les données sont fictives</span>
            </div>
            <div className="flex items-center gap-3">
                <button onClick={exitDemo} className="underline font-bold hover:opacity-70 transition-opacity">
                    Quitter le mode démo
                </button>
                <button onClick={() => setDismissed(true)} className="hover:opacity-70 transition-opacity">
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

// ── Skin bridge — wraps inner layout with SkinProvider using resolved role ────

function SkinBridge({ children }: { children: React.ReactNode }) {
    const { role } = useRole();
    return <SkinProvider defaultRole={role}>{children}</SkinProvider>;
}

// ── Inner layout (uses RoleContext) ───────────────────────────────────────────

function DashboardInner({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { key, label } = resolveNav(pathname);
    const { user } = useRole();
    const { data: kpis } = useKpis();
    const { notifications, pendingRegistrations, unreadCount, markRead, markAllRead } = useNotifications();

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
            <DemoBanner />
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
                {children}
            </main>

            <DashboardFooter />
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
