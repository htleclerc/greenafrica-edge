'use client';

import * as React from 'react';
import Link from 'next/link';
import {
    Map, Ship, FileText, Leaf, AlertTriangle,
    BarChart2, Settings, DollarSign, TrendingUp, UserCheck,
    ChevronLeft, ChevronRight, Calculator, LogOut, X,
    Scale, Anchor, ClipboardCheck, CreditCard, Users, Banknote, Wallet, Undo2, Globe2,
    LayoutDashboard, Bell, Eye, Plane, Building2,
} from 'lucide-react';
import { useRole } from '@/lib/RoleContext';
import { filterNavItems } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/client';
import { useTranslations } from 'next-intl';
import { AfricGreenLogo } from '@/components/ui/AfricGreenLogo';
import { JurisdictionSwitcher } from './JurisdictionSwitcher';
import { ModeSwitcher } from './ModeSwitcher';
import { OPERATOR_NAV, vesselsNavLabelKey, isAirOnly, type OperatorNavItem } from '@/lib/auth/operatorNav';
import { usePrincipalKind } from '@/hooks/usePrincipalKind';

export const SIDEBAR_COLLAPSED = 56;
export const SIDEBAR_EXPANDED  = 220;

interface NavItem {
    key: string;
    icon: React.ReactNode;
    href: string;
    labelKey: string;
    section?: 'ops' | 'admin';
    badge?: number;
}

const NAV_ITEMS: NavItem[] = [
    { key: 'vision',       icon: <Eye className="w-5 h-5" />,           href: '/dashboard/vision',      labelKey: 'nav_vision',       section: 'ops' },
    { key: 'map',          icon: <Map className="w-5 h-5" />,           href: '/dashboard',             labelKey: 'nav_map',          section: 'ops' },
    { key: 'simulator',    icon: <Calculator className="w-5 h-5" />,    href: '/dashboard/simulator',   labelKey: 'nav_simulator',    section: 'ops' },
    { key: 'vessels',      icon: <Ship className="w-5 h-5" />,          href: '/dashboard/vessels',     labelKey: 'nav_vessels',      section: 'ops' },
    { key: 'invoices',     icon: <FileText className="w-5 h-5" />,      href: '/dashboard/invoices',    labelKey: 'nav_invoices',     section: 'ops' },
    { key: 'disputes',     icon: <Scale className="w-5 h-5" />,         href: '/dashboard/disputes',    labelKey: 'nav_disputes',     section: 'ops' },
    { key: 'my-fleet',     icon: <Anchor className="w-5 h-5" />,        href: '/dashboard/my-fleet',    labelKey: 'nav_my_fleet',     section: 'ops' },
    { key: 'tco',          icon: <DollarSign className="w-5 h-5" />,    href: '/dashboard/tco',         labelKey: 'nav_tco',          section: 'ops' },
    { key: 'inspector',    icon: <ClipboardCheck className="w-5 h-5" />,href: '/dashboard/inspector',   labelKey: 'nav_inspector',    section: 'ops' },
    { key: 'green-ledger', icon: <Leaf className="w-5 h-5" />,          href: '/dashboard/projects',    labelKey: 'nav_green_ledger', section: 'ops' },
    { key: 'alerts',       icon: <AlertTriangle className="w-5 h-5" />, href: '/dashboard/alerts',      labelKey: 'nav_alerts',       section: 'ops' },
    { key: 'analytics',    icon: <BarChart2 className="w-5 h-5" />,     href: '/dashboard/reports',     labelKey: 'nav_analytics',    section: 'ops' },
    { key: 'validations',  icon: <UserCheck className="w-5 h-5" />,     href: '/dashboard/validations', labelKey: 'nav_validations',  section: 'admin' },
    { key: 'registrations', icon: <Users className="w-5 h-5" />,         href: '/admin/registrations',   labelKey: 'nav_registrations', section: 'admin' },
    { key: 'tax-settings', icon: <DollarSign className="w-5 h-5" />,    href: '/admin/tax-settings',    labelKey: 'nav_tax_settings', section: 'admin' },
    { key: 'origin-port-proposals', icon: <Anchor className="w-5 h-5" />, href: '/admin/origin-port-proposals', labelKey: 'nav_origin_port_proposals', section: 'admin' },
    { key: 'revenue',      icon: <TrendingUp className="w-5 h-5" />,    href: '/admin/revenue',         labelKey: 'nav_revenue',      section: 'admin' },
    { key: 'payments',     icon: <CreditCard className="w-5 h-5" />,    href: '/admin/payments',        labelKey: 'nav_payments',     section: 'admin' },
    { key: 'refunds',      icon: <Undo2 className="w-5 h-5" />,         href: '/admin/refunds',         labelKey: 'nav_refunds',      section: 'admin' },
    { key: 'cash-desk',    icon: <Banknote className="w-5 h-5" />,      href: '/admin/cash-desk',       labelKey: 'nav_cash_desk',    section: 'admin' },
    { key: 'wallets',      icon: <Wallet className="w-5 h-5" />,        href: '/admin/wallets',         labelKey: 'nav_wallets',      section: 'admin' },
    { key: 'jurisdictions', icon: <Globe2 className="w-5 h-5" />,      href: '/admin/jurisdictions',   labelKey: 'nav_jurisdictions', section: 'admin' },
    { key: 'admin-invoices', icon: <FileText className="w-5 h-5" />, href: '/admin/invoices', labelKey: 'nav_admin_invoices', section: 'admin' },
    { key: 'admin-collections', icon: <Scale className="w-5 h-5" />, href: '/admin/collections', labelKey: 'nav_admin_collections', section: 'admin' },
    { key: 'staff',         icon: <Users className="w-5 h-5" />,        href: '/admin/staff',           labelKey: 'nav_staff',         section: 'admin' },
    { key: 'armateurs',     icon: <Building2 className="w-5 h-5" />,    href: '/admin/armateurs',       labelKey: 'nav_armateurs',     section: 'admin' },
    { key: 'airlines',      icon: <Plane className="w-5 h-5" />,        href: '/admin/airlines',        labelKey: 'nav_airlines',      section: 'admin' },
];

// Icon map for operator nav items. Keyed by OperatorNavItem.key.
const OPERATOR_ICONS: Record<string, React.ReactNode> = {
    dashboard:     <LayoutDashboard className="w-5 h-5" />,
    vessels:       <Ship className="w-5 h-5" />,
    invoices:      <FileText className="w-5 h-5" />,
    wallet:        <Wallet className="w-5 h-5" />,
    simulator:     <Calculator className="w-5 h-5" />,
    tco:           <DollarSign className="w-5 h-5" />,
    disputes:      <Scale className="w-5 h-5" />,
    notifications: <Bell className="w-5 h-5" />,
};

interface DashboardSidebarProps {
    activePage?: string;
    expanded: boolean;
    onToggle: () => void;
    pendingRegistrations?: number;
    mobileOpen?: boolean;
    onMobileClose?: () => void;
}

// ── Principal detection ───────────────────────────────────────────────────────
//
// We cannot rely on RoleContext to detect operators: RoleContext only resolves
// staff sessions (via the `profiles` table). Operators have no profiles row, so
// Operator vs staff is resolved via the shared usePrincipalKind hook (GET
// /api/me/principal). While the fetch is in flight we render a neutral skeleton
// to avoid a nav flash (staff nav briefly visible before the operator nav kicks
// in). Once resolved:
//   kind === 'operator' → flat OPERATOR_NAV, no JurisdictionSwitcher
//   kind === 'staff'    → existing RBAC-filtered nav, unchanged

export function DashboardSidebar({ activePage, expanded, onToggle, pendingRegistrations = 0, mobileOpen = false, onMobileClose }: DashboardSidebarProps) {
    const t = useTranslations('Dashboard');
    const tOwner = useTranslations('OwnerPortal');
    const { role } = useRole();
    const { kind, modes } = usePrincipalKind();

    const opsItems   = filterNavItems(NAV_ITEMS.filter((i) => i.section === 'ops'), role);
    const adminItems = filterNavItems(NAV_ITEMS.filter((i) => i.section === 'admin'), role)
        .map((item) => item.key === 'validations' && pendingRegistrations > 0
            ? { ...item, badge: pendingRegistrations }
            : item
        );

    // ── Skeleton nav (while principal kind is resolving) ──────────────────────
    // Render 8 placeholder rows to match the operator nav height and avoid the
    // layout jumping between a staff nav (many items) and operator nav (8 items).
    const renderSkeletonNav = () => (
        <nav className="flex-1 flex flex-col w-full px-1.5 overflow-y-auto gap-0.5 mt-1">
            {Array.from({ length: 8 }).map((_, i) => (
                <div
                    key={i}
                    className="flex items-center gap-2.5 px-2.5 rounded-xl"
                    style={{ minHeight: 40 }}
                >
                    <span
                        className="w-5 h-5 rounded flex-shrink-0 animate-pulse"
                        style={{ backgroundColor: 'var(--os-border)', minWidth: 20 }}
                    />
                    {(expanded || mobileOpen) && (
                        <span
                            className="h-3 rounded animate-pulse"
                            style={{ width: 80, backgroundColor: 'var(--os-border)' }}
                        />
                    )}
                </div>
            ))}
        </nav>
    );

    // ── Operator nav ──────────────────────────────────────────────────────────
    // The "vessels" entry adapts to the operator's mode(s): an AIR-only operator
    // sees "Aircraft" + a Plane icon, a multi-mode operator sees "Fleet", and a
    // maritime operator keeps "Vessels" + Ship icon (default, unchanged).
    const vesselsLabelKey = vesselsNavLabelKey(modes);
    const airOnly = isAirOnly(modes);
    const renderOperatorNav = () => (
        <nav className="flex-1 flex flex-col w-full px-1.5 overflow-y-auto gap-0.5">
            {OPERATOR_NAV.map((item) => {
                const isVessels = item.key === 'vessels';
                return (
                    <OperatorNavButton
                        key={item.key}
                        item={isVessels ? { ...item, labelKey: vesselsLabelKey } : item}
                        icon={isVessels && airOnly ? <Plane className="w-5 h-5" /> : OPERATOR_ICONS[item.key]}
                        isActive={activePage === item.key}
                        expanded={expanded || mobileOpen}
                        t={tOwner}
                        onNavigate={onMobileClose}
                    />
                );
            })}
        </nav>
    );

    // ── Staff nav (existing behaviour, unchanged) ─────────────────────────────
    const renderStaffNav = () => (
        <>
            {/* Jurisdiction switcher (staff with >1 jurisdiction) */}
            <JurisdictionSwitcher expanded={expanded || mobileOpen} />
            {/* Mode switcher (maritime / air / both) — hidden when jurisdiction has only 1 mode */}
            <ModeSwitcher expanded={expanded || mobileOpen} />

            <nav className="flex-1 flex flex-col w-full px-1.5 overflow-y-auto gap-0.5">
                {(expanded || mobileOpen) && (
                    <p className="text-[9px] font-bold uppercase tracking-widest px-2 mb-1" style={{ color: 'var(--os-text-muted)' }}>
                        {t('section_operations')}
                    </p>
                )}
                {opsItems.map((item) => (
                    <NavButton key={item.key} item={item} isActive={activePage === item.key} expanded={expanded || mobileOpen} t={t} onNavigate={onMobileClose} />
                ))}

                {adminItems.length > 0 && (
                    <>
                        <div className="h-px my-2 mx-1 flex-shrink-0" style={{ backgroundColor: 'var(--os-border)' }} />
                        {(expanded || mobileOpen) && (
                            <p className="text-[9px] font-bold uppercase tracking-widest px-2 mb-1" style={{ color: 'var(--os-text-muted)' }}>
                                {t('section_administration')}
                            </p>
                        )}
                        {adminItems.map((item) => (
                            <NavButton key={item.key} item={item} isActive={activePage === item.key} expanded={expanded || mobileOpen} t={t} onNavigate={onMobileClose} />
                        ))}
                    </>
                )}
            </nav>
        </>
    );

    return (
        <>
            {/* ── Mobile overlay backdrop ── */}
            {mobileOpen && (
                <div
                    className="fixed inset-0 bg-black/60 dashboard-mobile-only"
                    style={{ zIndex: 9998 }}
                    onClick={onMobileClose}
                />
            )}

            {/* ── Sidebar panel ── */}
            <aside
                className={`fixed left-0 top-0 bottom-0 flex flex-col py-3 overflow-hidden transition-transform duration-300 ease-in-out md:translate-x-0 ${
                    mobileOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
                style={{
                    zIndex: mobileOpen ? 9999 : 40,
                    width: mobileOpen ? SIDEBAR_EXPANDED : (expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED),
                    backgroundColor: 'var(--os-surface)',
                    borderRight: '1px solid var(--os-border)',
                    transition: 'width 220ms cubic-bezier(0.4,0,0.2,1), transform 300ms cubic-bezier(0.4,0,0.2,1)',
                }}
            >
                {/* Mobile close button */}
                {mobileOpen && (
                    <button
                        onClick={onMobileClose}
                        className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors dashboard-mobile-only"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}

                {/* Logo + app name */}
                <Link
                    href="/dashboard"
                    onClick={onMobileClose}
                    className="flex items-center gap-2.5 flex-shrink-0 mb-4 px-3 h-10"
                    title="Green Gate"
                >
                    <AfricGreenLogo size={40} variant="dark" className="flex-shrink-0 rounded-xl" />
                    <div
                        className="flex flex-col overflow-hidden"
                        style={{
                            opacity: expanded ? 1 : 0,
                            transition: 'opacity 150ms ease',
                            pointerEvents: expanded ? 'auto' : 'none',
                        }}
                    >
                        <span className="text-sm font-bold leading-tight whitespace-nowrap" style={{ color: 'var(--os-text-primary)' }}>
                            {t('sidebar_app_title')}
                        </span>
                        <span className="text-[9px] font-semibold tracking-widest uppercase text-emerald-500/60 leading-tight whitespace-nowrap">
                            {t('sidebar_app_subtitle')}
                        </span>
                    </div>
                </Link>

                {/* Nav — three states: resolving (skeleton) | operator | staff */}
                {kind === null
                    ? renderSkeletonNav()
                    : kind === 'operator'
                        ? renderOperatorNav()
                        : renderStaffNav()
                }

                {/* Bottom: Settings + logout + status */}
                <div className="flex flex-col gap-1 px-1.5 mt-2 flex-shrink-0">
                    <NavButton
                        item={{ key: 'settings', icon: <Settings className="w-5 h-5" />, href: '/dashboard/settings', labelKey: 'nav_settings' }}
                        isActive={activePage === 'settings'}
                        expanded={expanded || mobileOpen}
                        t={t}
                        onNavigate={onMobileClose}
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
                        title={(expanded || mobileOpen) ? undefined : t('sidebar_logout')}
                        className="relative flex items-center gap-2.5 px-2.5 rounded-xl transition-all flex-shrink-0 group hover:bg-[rgba(239,68,68,0.08)]"
                        style={{ color: 'var(--os-text-muted)', minHeight: 40 }}
                    >
                        <span className="w-5 h-5 flex items-center justify-center flex-shrink-0" style={{ minWidth: 20 }}>
                            <LogOut className="w-5 h-5" />
                        </span>
                        <span
                            className="text-xs font-medium whitespace-nowrap overflow-hidden text-[#EF4444]"
                            style={{
                                maxWidth: (expanded || mobileOpen) ? 140 : 0,
                                opacity: (expanded || mobileOpen) ? 1 : 0,
                                transition: 'max-width 220ms cubic-bezier(0.4,0,0.2,1), opacity 150ms ease',
                            }}
                        >
                            {t('sidebar_logout')}
                        </span>
                        {!(expanded || mobileOpen) && (
                            <span
                                className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg whitespace-nowrap text-xs opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50"
                                style={{
                                    backgroundColor: 'var(--os-surface-3)',
                                    border: '1px solid var(--os-border)',
                                    color: '#EF4444',
                                }}
                            >
                                {t('sidebar_logout')}
                            </span>
                        )}
                    </button>

                    <div className="h-px mx-1 flex-shrink-0" style={{ backgroundColor: 'var(--os-border)' }} />

                    <div className="flex items-center gap-2 px-2.5 py-1.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0 os-dot-online" title={t('sidebar_system_online')} />
                        <span
                            className="text-[10px] font-medium whitespace-nowrap"
                            style={{
                                color: 'var(--os-text-muted)',
                                opacity: (expanded || mobileOpen) ? 1 : 0,
                                transition: 'opacity 150ms ease',
                            }}
                        >
                            {t('sidebar_system_online')}
                        </span>
                    </div>
                </div>
            </aside>

            {/* ── Toggle tab — floats on the right edge of the sidebar (desktop only) ── */}
            <button
                onClick={onToggle}
                title={expanded ? t('sidebar_collapse') : t('sidebar_expand')}
                className="fixed z-50 hidden md:flex items-center justify-center rounded-r-lg transition-all"
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

// ── NavButton (staff) ─────────────────────────────────────────────────────────

interface NavButtonProps {
    item: NavItem;
    isActive: boolean;
    expanded: boolean;
    t: (key: string) => string;
    onNavigate?: () => void;
}

function NavButton({ item, isActive, expanded, t, onNavigate }: NavButtonProps) {
    const label = t(item.labelKey);
    return (
        <Link
            href={item.href}
            onClick={onNavigate}
            title={expanded ? undefined : label}
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
                {label}
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
                    {label}{item.badge ? ` (${item.badge})` : ''}
                </span>
            )}
        </Link>
    );
}

// ── OperatorNavButton ─────────────────────────────────────────────────────────

interface OperatorNavButtonProps {
    item: OperatorNavItem;
    icon: React.ReactNode;
    isActive: boolean;
    expanded: boolean;
    t: (key: string) => string;
    onNavigate?: () => void;
}

function OperatorNavButton({ item, icon, isActive, expanded, t, onNavigate }: OperatorNavButtonProps) {
    const label = t(item.labelKey);
    return (
        <Link
            href={item.href}
            onClick={onNavigate}
            title={expanded ? undefined : label}
            className="relative flex items-center gap-2.5 px-2.5 rounded-xl transition-all flex-shrink-0 group"
            style={{
                color: isActive ? '#10B981' : 'var(--os-text-muted)',
                backgroundColor: isActive ? 'rgba(16,185,129,0.12)' : 'transparent',
                boxShadow: isActive ? 'inset 2px 0 0 #10B981' : 'none',
                minHeight: 40,
            }}
        >
            <span className="w-5 h-5 flex items-center justify-center flex-shrink-0" style={{ minWidth: 20 }}>
                {icon}
            </span>
            <span
                className="text-xs font-medium whitespace-nowrap overflow-hidden"
                style={{
                    maxWidth: expanded ? 140 : 0,
                    opacity: expanded ? 1 : 0,
                    transition: 'max-width 220ms cubic-bezier(0.4,0,0.2,1), opacity 150ms ease',
                }}
            >
                {label}
            </span>
            {!expanded && (
                <span
                    className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg whitespace-nowrap text-xs opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50"
                    style={{
                        backgroundColor: 'var(--os-surface-3)',
                        border: '1px solid var(--os-border)',
                        color: 'var(--os-text-primary)',
                    }}
                >
                    {label}
                </span>
            )}
        </Link>
    );
}
