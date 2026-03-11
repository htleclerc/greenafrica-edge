'use client';

import * as React from 'react';
import Link from 'next/link';
import {
    Map, Ship, FileText, Leaf, AlertTriangle,
    BarChart2, Settings, DollarSign, TrendingUp, UserCheck,
    ChevronLeft, ChevronRight, Calculator, LogOut,
} from 'lucide-react';
import { useRole } from '@/lib/RoleContext';
import { filterNavItems } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/client';

export const SIDEBAR_COLLAPSED = 56;
export const SIDEBAR_EXPANDED  = 220;

interface NavItem {
    key: string;
    icon: React.ReactNode;
    href: string;
    label: string;
    section?: 'ops' | 'admin';
    badge?: number;
}

const NAV_ITEMS: NavItem[] = [
    { key: 'map',          icon: <Map className="w-5 h-5" />,           href: '/dashboard',             label: 'The Eye (Map)',         section: 'ops' },
    { key: 'simulator',    icon: <Calculator className="w-5 h-5" />,    href: '/dashboard/simulator',   label: 'Simulateur de Taxe',    section: 'ops' },
    { key: 'vessels',      icon: <Ship className="w-5 h-5" />,          href: '/dashboard/vessels',     label: 'Navires & Conformité',  section: 'ops' },
    { key: 'invoices',     icon: <FileText className="w-5 h-5" />,      href: '/dashboard/invoices',    label: 'Factures & Paiements',  section: 'ops' },
    { key: 'green-ledger', icon: <Leaf className="w-5 h-5" />,          href: '/dashboard/projects',    label: 'Green Ledger',          section: 'ops' },
    { key: 'alerts',       icon: <AlertTriangle className="w-5 h-5" />, href: '/dashboard/alerts',      label: 'Alertes & Exceptions',  section: 'ops' },
    { key: 'analytics',    icon: <BarChart2 className="w-5 h-5" />,     href: '/dashboard/reports',     label: 'Analytics & Rapports',  section: 'ops' },
    { key: 'validations',  icon: <UserCheck className="w-5 h-5" />,     href: '/dashboard/validations', label: 'Validation des agents', section: 'admin', badge: 2 },
    { key: 'tax-settings', icon: <DollarSign className="w-5 h-5" />,    href: '/admin/tax-settings',    label: 'Taxe carbone',          section: 'admin' },
    { key: 'revenue',      icon: <TrendingUp className="w-5 h-5" />,    href: '/admin/revenue',         label: 'Tableau des recettes',  section: 'admin' },
];

interface DashboardSidebarProps {
    activePage?: string;
    expanded: boolean;
    onToggle: () => void;
}

export function DashboardSidebar({ activePage, expanded, onToggle }: DashboardSidebarProps) {
    const { role } = useRole();
    const opsItems   = filterNavItems(NAV_ITEMS.filter((i) => i.section === 'ops'), role);
    const adminItems = filterNavItems(NAV_ITEMS.filter((i) => i.section === 'admin'), role);

    return (
        <>
            {/* ── Sidebar panel ── */}
            <aside
                className="fixed left-0 top-0 bottom-0 z-40 flex flex-col py-3 overflow-hidden"
                style={{
                    width: expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED,
                    backgroundColor: 'var(--os-surface)',
                    borderRight: '1px solid var(--os-border)',
                    transition: 'width 220ms cubic-bezier(0.4,0,0.2,1)',
                }}
            >
                {/* Logo + app name */}
                <Link
                    href="/dashboard"
                    className="flex items-center gap-2.5 flex-shrink-0 mb-4 px-3 h-10"
                    title="Africgreen"
                >
                    <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{
                            backgroundColor: 'rgba(16,185,129,0.1)',
                            border: '1px solid rgba(16,185,129,0.2)',
                            minWidth: 40,
                        }}
                    >
                        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                            <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" fill="#10B981" />
                        </svg>
                    </div>
                    <div
                        className="flex flex-col overflow-hidden"
                        style={{
                            opacity: expanded ? 1 : 0,
                            transition: 'opacity 150ms ease',
                            pointerEvents: expanded ? 'auto' : 'none',
                        }}
                    >
                        <span className="text-sm font-bold leading-tight whitespace-nowrap" style={{ color: 'var(--os-text-primary)' }}>
                            AIS Portal
                        </span>
                        <span className="text-[9px] font-semibold tracking-widest uppercase text-emerald-500/60 leading-tight whitespace-nowrap">
                            Africgreen
                        </span>
                    </div>
                </Link>

                {/* Nav */}
                <nav className="flex-1 flex flex-col w-full px-1.5 overflow-y-auto gap-0.5">
                    {expanded && (
                        <p className="text-[9px] font-bold uppercase tracking-widest px-2 mb-1" style={{ color: 'var(--os-text-muted)' }}>
                            Opérations
                        </p>
                    )}
                    {opsItems.map((item) => (
                        <NavButton key={item.key} item={item} isActive={activePage === item.key} expanded={expanded} />
                    ))}

                    {adminItems.length > 0 && (
                        <>
                            <div className="h-px my-2 mx-1 flex-shrink-0" style={{ backgroundColor: 'var(--os-border)' }} />
                            {expanded && (
                                <p className="text-[9px] font-bold uppercase tracking-widest px-2 mb-1" style={{ color: 'var(--os-text-muted)' }}>
                                    Administration
                                </p>
                            )}
                            {adminItems.map((item) => (
                                <NavButton key={item.key} item={item} isActive={activePage === item.key} expanded={expanded} />
                            ))}
                        </>
                    )}
                </nav>

                {/* Bottom: Settings + logout + status */}
                <div className="flex flex-col gap-1 px-1.5 mt-2 flex-shrink-0">
                    <NavButton
                        item={{ key: 'settings', icon: <Settings className="w-5 h-5" />, href: '/dashboard/settings', label: 'Paramètres' }}
                        isActive={activePage === 'settings'}
                        expanded={expanded}
                    />

                    {/* Logout */}
                    <button
                        onClick={async () => {
                            document.cookie = 'demo_active=; path=/; max-age=0';
                            document.cookie = 'demo_role=; path=/; max-age=0';
                            localStorage.removeItem('demo_active');
                            localStorage.removeItem('demo_role');
                            const supabase = createClient();
                            await supabase.auth.signOut();
                            window.location.href = '/login';
                        }}
                        title={expanded ? undefined : 'Déconnexion'}
                        className="relative flex items-center gap-2.5 px-2.5 rounded-xl transition-all flex-shrink-0 group hover:bg-[rgba(239,68,68,0.08)]"
                        style={{ color: 'var(--os-text-muted)', minHeight: 40 }}
                    >
                        <span className="w-5 h-5 flex items-center justify-center flex-shrink-0" style={{ minWidth: 20 }}>
                            <LogOut className="w-5 h-5" />
                        </span>
                        <span
                            className="text-xs font-medium whitespace-nowrap overflow-hidden text-[#EF4444]"
                            style={{
                                maxWidth: expanded ? 140 : 0,
                                opacity: expanded ? 1 : 0,
                                transition: 'max-width 220ms cubic-bezier(0.4,0,0.2,1), opacity 150ms ease',
                            }}
                        >
                            Déconnexion
                        </span>
                        {!expanded && (
                            <span
                                className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg whitespace-nowrap text-xs opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50"
                                style={{
                                    backgroundColor: 'var(--os-surface-3)',
                                    border: '1px solid var(--os-border)',
                                    color: '#EF4444',
                                }}
                            >
                                Déconnexion
                            </span>
                        )}
                    </button>

                    <div className="h-px mx-1 flex-shrink-0" style={{ backgroundColor: 'var(--os-border)' }} />

                    <div className="flex items-center gap-2 px-2.5 py-1.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0 os-dot-online" title="Système en ligne" />
                        <span
                            className="text-[10px] font-medium whitespace-nowrap"
                            style={{
                                color: 'var(--os-text-muted)',
                                opacity: expanded ? 1 : 0,
                                transition: 'opacity 150ms ease',
                            }}
                        >
                            Système en ligne
                        </span>
                    </div>
                </div>
            </aside>

            {/* ── Toggle tab — floats on the right edge of the sidebar ── */}
            <button
                onClick={onToggle}
                title={expanded ? 'Réduire le menu' : 'Agrandir le menu'}
                className="fixed z-50 flex items-center justify-center rounded-r-lg transition-all"
                style={{
                    left: expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 16,
                    height: 40,
                    backgroundColor: 'var(--os-surface-3)',
                    border: '1px solid var(--os-border)',
                    borderLeft: 'none',
                    color: 'var(--os-text-muted)',
                    transition: 'left 220ms cubic-bezier(0.4,0,0.2,1), background-color 150ms',
                    cursor: 'pointer',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--os-surface-2)'; (e.currentTarget as HTMLElement).style.color = '#10B981'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--os-surface-3)'; (e.currentTarget as HTMLElement).style.color = 'var(--os-text-muted)'; }}
            >
                {expanded
                    ? <ChevronLeft className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />
                }
            </button>
        </>
    );
}

// ── NavButton ─────────────────────────────────────────────────────────────────

interface NavButtonProps {
    item: NavItem;
    isActive: boolean;
    expanded: boolean;
}

function NavButton({ item, isActive, expanded }: NavButtonProps) {
    return (
        <Link
            href={item.href}
            title={expanded ? undefined : item.label}
            className="relative flex items-center gap-2.5 px-2.5 rounded-xl transition-all flex-shrink-0 group"
            style={{
                color: isActive ? '#10B981' : 'var(--os-text-muted)',
                backgroundColor: isActive ? 'rgba(16,185,129,0.12)' : 'transparent',
                boxShadow: isActive ? 'inset 2px 0 0 #10B981' : 'none',
                minHeight: 40,
            }}
        >
            {/* Icon */}
            <span className="w-5 h-5 flex items-center justify-center flex-shrink-0" style={{ minWidth: 20 }}>
                {item.icon}
            </span>

            {/* Label */}
            <span
                className="text-xs font-medium whitespace-nowrap overflow-hidden"
                style={{
                    maxWidth: expanded ? 140 : 0,
                    opacity: expanded ? 1 : 0,
                    transition: 'max-width 220ms cubic-bezier(0.4,0,0.2,1), opacity 150ms ease',
                }}
            >
                {item.label}
            </span>

            {/* Badge */}
            {item.badge && item.badge > 0 && (
                <span
                    className="flex-shrink-0 min-w-[18px] h-[18px] rounded-full text-[9px] font-bold flex items-center justify-center text-white px-1 ml-auto"
                    style={{
                        backgroundColor: '#EAB308',
                        opacity: expanded ? 1 : 0,
                        transition: 'opacity 150ms ease',
                    }}
                >
                    {item.badge}
                </span>
            )}

            {/* Badge collapsed (absolute) */}
            {item.badge && item.badge > 0 && !expanded && (
                <span
                    className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white"
                    style={{ backgroundColor: '#EAB308' }}
                >
                    {item.badge}
                </span>
            )}

            {/* Tooltip — collapsed only */}
            {!expanded && (
                <span
                    className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg whitespace-nowrap text-xs opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50"
                    style={{
                        backgroundColor: 'var(--os-surface-3)',
                        border: '1px solid var(--os-border)',
                        color: 'var(--os-text-primary)',
                    }}
                >
                    {item.label}{item.badge ? ` (${item.badge})` : ''}
                </span>
            )}
        </Link>
    );
}
