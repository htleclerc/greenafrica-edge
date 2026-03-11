'use client';

import * as React from 'react';
import Link from 'next/link';
import {
    Bell, ChevronDown, AlertCircle, LogOut, Settings, User,
    Shield, Ship, AlertTriangle, CreditCard, CheckCircle, Clock,
    MapPin,
} from 'lucide-react';
import { DashboardKpis, SecureUser, UserRole } from '@/types/secure';
import { createClient } from '@/lib/supabase/client';

// ── Country flag emoji from ISO 3166-1 alpha-2 ──────────────────────────────

function countryFlag(code: string): string {
    const upper = code.toUpperCase();
    const offset = 0x1F1E6;
    const a = upper.charCodeAt(0) - 65 + offset;
    const b = upper.charCodeAt(1) - 65 + offset;
    return String.fromCodePoint(a, b);
}

// ── Role labels ──────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<UserRole, string> = {
    [UserRole.PORT_OFFICER]:    'Officier de Port',
    [UserRole.FINANCE_ADMIN]:   'Admin Financier',
    [UserRole.SHIPPING_AGENT]:  'Armateur / Agent',
    [UserRole.SUPERADMIN]:      'Super Admin',
};

const ROLE_COLOR: Record<UserRole, string> = {
    [UserRole.PORT_OFFICER]:    '#10B981',
    [UserRole.FINANCE_ADMIN]:   '#EAB308',
    [UserRole.SHIPPING_AGENT]:  '#3B82F6',
    [UserRole.SUPERADMIN]:      '#F97316',
};

// ── Mock notifications ───────────────────────────────────────────────────────

interface Notification {
    id: string;
    icon: React.ReactNode;
    iconColor: string;
    title: string;
    message: string;
    time: string;
    read: boolean;
}

const MOCK_NOTIFICATIONS: Notification[] = [
    {
        id: 'n1',
        icon: <AlertTriangle className="w-3.5 h-3.5" />,
        iconColor: '#EF4444',
        title: 'Navire non-conforme detecte',
        message: 'OCEAN VOYAGER (IMO 9554433) — Non-compliance AIS en ZEE',
        time: 'Il y a 12 min',
        read: false,
    },
    {
        id: 'n2',
        icon: <CreditCard className="w-3.5 h-3.5" />,
        iconColor: '#F59E0B',
        title: 'Paiement en attente',
        message: 'CMA CGM AFRICA — Facture Port Stay $1,924 en attente',
        time: 'Il y a 45 min',
        read: false,
    },
    {
        id: 'n3',
        icon: <Ship className="w-3.5 h-3.5" />,
        iconColor: '#3B82F6',
        title: 'Nouveau navire en ZEE',
        message: 'MAERSK SEALAND entre dans la ZEE Somaliland via Berbera',
        time: 'Il y a 1h',
        read: false,
    },
    {
        id: 'n4',
        icon: <CheckCircle className="w-3.5 h-3.5" />,
        iconColor: '#10B981',
        title: 'Paiement recu',
        message: 'HAPAG-LLOYD JEDDAH — Transit Fee $6,022 encaisse',
        time: 'Il y a 3h',
        read: true,
    },
    {
        id: 'n5',
        icon: <Shield className="w-3.5 h-3.5" />,
        iconColor: '#8B5CF6',
        title: 'Demande d\'inscription',
        message: 'Gulf Marine Services FZCO — En attente de validation',
        time: 'Il y a 5h',
        read: true,
    },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
}

function formatTons(n: number): string {
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}kt`;
    return `${n}t`;
}

// ── useClickOutside ──────────────────────────────────────────────────────────

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
    React.useEffect(() => {
        function listener(e: MouseEvent) {
            if (!ref.current || ref.current.contains(e.target as Node)) return;
            handler();
        }
        document.addEventListener('mousedown', listener);
        return () => document.removeEventListener('mousedown', listener);
    }, [ref, handler]);
}

// ── Main component ───────────────────────────────────────────────────────────

interface DashboardTopBarProps {
    user: SecureUser;
    kpis: DashboardKpis;
    breadcrumb?: string;
}

export function DashboardTopBar({ user, kpis, breadcrumb }: DashboardTopBarProps) {
    const isOnline   = kpis.systemStatus === 'ONLINE';
    const isDegraded = kpis.systemStatus === 'DEGRADED';

    const [notifOpen, setNotifOpen]     = React.useState(false);
    const [profileOpen, setProfileOpen] = React.useState(false);
    const [notifications, setNotifications] = React.useState(MOCK_NOTIFICATIONS);

    const notifRef   = React.useRef<HTMLDivElement>(null);
    const profileRef = React.useRef<HTMLDivElement>(null);

    useClickOutside(notifRef, () => setNotifOpen(false));
    useClickOutside(profileRef, () => setProfileOpen(false));

    const unreadCount = notifications.filter((n) => !n.read).length;

    function markAllRead() {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }

    async function handleLogout() {
        document.cookie = 'demo_active=; path=/; max-age=0';
        document.cookie = 'demo_role=; path=/; max-age=0';
        localStorage.removeItem('demo_active');
        localStorage.removeItem('demo_role');
        const supabase = createClient();
        await supabase.auth.signOut();
        window.location.href = '/login';
    }

    const flag      = countryFlag(user.countryCode);
    const roleColor = ROLE_COLOR[user.role];
    const roleLabel = ROLE_LABEL[user.role];
    const initials  = user.fullName
        .split(' ')
        .map((w) => w.charAt(0))
        .slice(0, 2)
        .join('')
        .toUpperCase();

    return (
        <header
            className="fixed top-0 right-0 z-30 flex items-center h-14 px-4 gap-4"
            style={{
                left: 'var(--os-sidebar-w)',
                backgroundColor: 'var(--os-surface)',
                borderBottom: '1px solid var(--os-border)',
                transition: 'left 220ms cubic-bezier(0.4,0,0.2,1)',
            }}
        >
            {/* Brand + breadcrumb */}
            <div className="flex items-center gap-2 mr-2 min-w-0">
                <span className="text-sm font-bold text-[var(--os-text-primary)] whitespace-nowrap">
                    Africgreen<span className="text-[#00D97E]">OS</span>
                </span>
                {breadcrumb && (
                    <>
                        <span className="text-[var(--os-text-muted)] text-sm">/</span>
                        <span className="text-sm text-[var(--os-text-secondary)] truncate">{breadcrumb}</span>
                    </>
                )}
            </div>

            {/* KPI Pills — center */}
            <div className="flex-1 flex items-center justify-center gap-1 overflow-x-auto">
                <KpiPill label="MONTHLY REVENUE" value={formatUsd(kpis.monthlyRevenueUsd)} accent />
                <KpiPill label="VESSELS PROCESSED" value={String(kpis.vesselsProcessed)} />
                <KpiPill label="EST. CO2" value={formatTons(kpis.estCo2TrackingTons)} />
                <KpiPill label="CREDITS RETIRED" value={formatTons(kpis.creditsRetiredTons)} />
            </div>

            {/* Right: system status + notifications + user */}
            <div className="flex items-center gap-2 flex-shrink-0">
                {/* Sync status */}
                <div className={`
                    flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                    ${isOnline
                        ? 'bg-[rgba(0,217,126,0.08)] text-[#00D97E]'
                        : isDegraded
                            ? 'bg-[rgba(245,158,11,0.08)] text-[#F59E0B]'
                            : 'bg-[rgba(239,68,68,0.08)] text-[#EF4444]'
                    }
                `}>
                    {isDegraded && <AlertCircle className="w-3.5 h-3.5" />}
                    {!isDegraded && <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'os-dot-online' : 'os-dot-offline'}`} />}
                    <span className="hidden md:inline">
                        {isDegraded ? 'DEGRADED SYNC' : isOnline ? 'ONLINE' : 'OFFLINE'}
                    </span>
                </div>

                {/* ── Notifications bell ── */}
                <div className="relative" ref={notifRef}>
                    <button
                        onClick={() => { setNotifOpen((v) => !v); setProfileOpen(false); }}
                        className="relative w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:bg-[var(--os-surface-2)] hover:text-[var(--os-text-primary)] transition-colors"
                    >
                        <Bell className="w-4 h-4" />
                        {unreadCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#EF4444] text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>

                    {/* Notification dropdown */}
                    {notifOpen && (
                        <div
                            className="absolute right-0 top-full mt-2 w-[360px] rounded-xl overflow-hidden shadow-2xl"
                            style={{
                                backgroundColor: 'var(--os-surface)',
                                border: '1px solid var(--os-border)',
                            }}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--os-border)]">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xs font-bold text-[var(--os-text-primary)]">Notifications</h3>
                                    {unreadCount > 0 && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#EF4444]/15 text-[#EF4444]">
                                            {unreadCount} nouvelles
                                        </span>
                                    )}
                                </div>
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllRead}
                                        className="text-[10px] font-semibold text-[#10B981] hover:text-[#34D399] transition-colors"
                                    >
                                        Tout marquer lu
                                    </button>
                                )}
                            </div>

                            {/* List */}
                            <div className="max-h-80 overflow-y-auto">
                                {notifications.map((n) => (
                                    <div
                                        key={n.id}
                                        className="flex items-start gap-3 px-4 py-3 border-b border-[var(--os-border)] last:border-0 transition-colors hover:bg-[var(--os-surface-2)] cursor-pointer"
                                        style={{ backgroundColor: n.read ? 'transparent' : 'rgba(16,185,129,0.03)' }}
                                    >
                                        <div
                                            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                                            style={{ backgroundColor: `${n.iconColor}14`, color: n.iconColor }}
                                        >
                                            {n.icon}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="text-xs font-semibold text-[var(--os-text-primary)] leading-tight">{n.title}</p>
                                                {!n.read && (
                                                    <span className="w-2 h-2 rounded-full bg-[#10B981] flex-shrink-0 mt-1" />
                                                )}
                                            </div>
                                            <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed mt-0.5 truncate">{n.message}</p>
                                            <p className="text-[10px] text-[var(--os-text-muted)] mt-1 flex items-center gap-1 opacity-60">
                                                <Clock className="w-2.5 h-2.5" />
                                                {n.time}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Footer */}
                            <Link
                                href="/dashboard/alerts"
                                onClick={() => setNotifOpen(false)}
                                className="flex items-center justify-center py-2.5 text-[10px] font-bold text-[#10B981] hover:bg-[var(--os-surface-2)] transition-colors border-t border-[var(--os-border)]"
                            >
                                Voir toutes les alertes
                            </Link>
                        </div>
                    )}
                </div>

                {/* Separator */}
                <div className="w-px h-6" style={{ backgroundColor: 'var(--os-border)' }} />

                {/* ── Profile button + dropdown ── */}
                <div className="relative" ref={profileRef}>
                    <button
                        onClick={() => { setProfileOpen((v) => !v); setNotifOpen(false); }}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-[var(--os-surface-2)] transition-colors"
                    >
                        {/* Avatar with flag */}
                        <div className="relative">
                            <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                style={{ backgroundColor: roleColor }}
                            >
                                {initials}
                            </div>
                            <span
                                className="absolute -bottom-0.5 -right-0.5 text-[10px] leading-none"
                                title={user.countryCode}
                            >
                                {flag}
                            </span>
                        </div>
                        <div className="hidden md:flex flex-col items-start">
                            <span className="text-xs font-semibold text-[var(--os-text-primary)] leading-tight">{user.fullName}</span>
                            <span className="text-[10px] leading-tight font-medium" style={{ color: roleColor }}>{roleLabel}</span>
                        </div>
                        <ChevronDown
                            className="w-3.5 h-3.5 text-[var(--os-text-muted)] transition-transform"
                            style={{ transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        />
                    </button>

                    {/* Profile dropdown */}
                    {profileOpen && (
                        <div
                            className="absolute right-0 top-full mt-2 w-[260px] rounded-xl overflow-hidden shadow-2xl"
                            style={{
                                backgroundColor: 'var(--os-surface)',
                                border: '1px solid var(--os-border)',
                            }}
                        >
                            {/* User card */}
                            <div className="px-4 py-4 border-b border-[var(--os-border)]">
                                <div className="flex items-center gap-3">
                                    <div
                                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                                        style={{ backgroundColor: roleColor }}
                                    >
                                        {initials}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-[var(--os-text-primary)] truncate">{user.fullName}</p>
                                        <p className="text-[10px] text-[var(--os-text-muted)] truncate">{user.email}</p>
                                    </div>
                                </div>
                                <div className="mt-3 flex items-center gap-2 flex-wrap">
                                    <span
                                        className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md"
                                        style={{ backgroundColor: `${roleColor}18`, color: roleColor }}
                                    >
                                        {roleLabel}
                                    </span>
                                    <span className="text-[9px] font-medium text-[var(--os-text-muted)] flex items-center gap-1">
                                        <MapPin className="w-2.5 h-2.5" />
                                        {user.operationalSite.replace(/_/g, ' ')}
                                    </span>
                                    <span className="text-[10px]" title={user.countryCode}>{flag}</span>
                                </div>
                            </div>

                            {/* Menu items */}
                            <div className="py-1">
                                <ProfileMenuItem
                                    icon={<User className="w-3.5 h-3.5" />}
                                    label="Mon profil"
                                    sub={user.email}
                                    href="/dashboard/settings"
                                    onClick={() => setProfileOpen(false)}
                                />
                                <ProfileMenuItem
                                    icon={<Settings className="w-3.5 h-3.5" />}
                                    label="Parametres"
                                    sub="Langue, timezone, preferences"
                                    href="/dashboard/settings"
                                    onClick={() => setProfileOpen(false)}
                                />
                                <ProfileMenuItem
                                    icon={<Shield className="w-3.5 h-3.5" />}
                                    label="Securite"
                                    sub="Mot de passe, 2FA, sessions"
                                    href="/dashboard/settings"
                                    onClick={() => setProfileOpen(false)}
                                />
                            </div>

                            {/* Session info + logout */}
                            <div className="border-t border-[var(--os-border)] px-4 py-2">
                                <div className="flex items-center justify-between text-[10px] text-[var(--os-text-muted)] mb-2">
                                    <span>Derniere connexion</span>
                                    <span className="font-mono">{new Date(user.lastLogin).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-[var(--os-text-muted)] mb-3">
                                    <span>IP</span>
                                    <span className="font-mono">{user.ipAddress}</span>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold text-[#EF4444] hover:bg-[rgba(239,68,68,0.08)] transition-colors"
                                >
                                    <LogOut className="w-3.5 h-3.5" />
                                    Deconnexion
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

// ── Profile menu item ────────────────────────────────────────────────────────

function ProfileMenuItem({
    icon, label, sub, href, onClick,
}: { icon: React.ReactNode; label: string; sub: string; href: string; onClick: () => void }) {
    return (
        <Link
            href={href}
            onClick={onClick}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--os-surface-2)] transition-colors"
        >
            <span className="text-[var(--os-text-muted)]">{icon}</span>
            <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--os-text-primary)]">{label}</p>
                <p className="text-[10px] text-[var(--os-text-muted)] truncate">{sub}</p>
            </div>
        </Link>
    );
}

// ── KPI Pill ─────────────────────────────────────────────────────────────────

function KpiPill({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className="flex flex-col items-center px-3 py-0.5 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] min-w-0">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] whitespace-nowrap">{label}</span>
            <span className={`text-sm font-bold tabular-nums leading-tight ${accent ? 'text-[#00D97E]' : 'text-[var(--os-text-primary)]'}`}>
                {value}
            </span>
        </div>
    );
}
