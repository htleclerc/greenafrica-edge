'use client';

import * as React from 'react';
import {
    Anchor, CheckCircle, ArrowRight, Rocket,
    MapPin, Eye, Building2, Ship, SkipForward,
} from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { UserRole, OperationalSite } from '@/types/secure';

// ── Roles available for impersonation (SUPERADMIN can test any role) ────────

interface RoleOption {
    key: UserRole;
    icon: React.ReactNode;
    title: string;
    description: string;
    accessLevel: string;
    color: string;
}

const IMPERSONATION_ROLES: RoleOption[] = [
    {
        key: UserRole.PORT_OFFICER,
        icon: <Anchor className="w-5 h-5" />,
        title: 'Port Authority Officer',
        description: 'Vessel clearance, compliance checks, and on-site inspections.',
        accessLevel: 'LEVEL 3',
        color: '#10B981',
    },
    {
        key: UserRole.SHIPPING_AGENT,
        icon: <Ship className="w-5 h-5" />,
        title: 'Armateur / Agent maritime',
        description: 'Gestion de flotte, déclarations DCS, factures et simulateur.',
        accessLevel: 'LEVEL 2',
        color: '#3B82F6',
    },
    {
        key: UserRole.FINANCE_ADMIN,
        icon: <Building2 className="w-5 h-5" />,
        title: 'Ministry of Finance',
        description: 'Revenue dashboard, audit logs, and financial reporting.',
        accessLevel: 'LEVEL 3',
        color: '#EAB308',
    },
];

// ── Sites ────────────────────────────────────────────────────────────────────

interface SiteOption {
    key: OperationalSite;
    name: string;
    coords: string;
}

const SITES: SiteOption[] = [
    { key: OperationalSite.BERBERA_PORT, name: 'Berbera Port Terminal', coords: '10.4396° N, 45.0143° E' },
    { key: OperationalSite.NATIONAL_HQ,  name: 'National HQ (Hargeisa)', coords: '9.5600° N, 44.0650° E' },
];

// ── Component ────────────────────────────────────────────────────────────────

export function PostLoginPage() {
    const [selectedRole, setSelectedRole]   = React.useState<UserRole | null>(null);
    const [selectedSite, setSelectedSite]   = React.useState<OperationalSite>(OperationalSite.BERBERA_PORT);
    const [loading, setLoading]             = React.useState(false);

    function persistAndGo(role: UserRole) {
        document.cookie = `demo_active=false; path=/; max-age=3600; SameSite=Lax`;
        document.cookie = `demo_role=${role}; path=/; max-age=3600; SameSite=Lax`;
        localStorage.setItem('demo_active', 'false');
        localStorage.setItem('demo_role', role);
    }

    async function handleLaunch() {
        if (!selectedRole) return;
        setLoading(true);
        persistAndGo(selectedRole);
        await new Promise((r) => setTimeout(r, 800));
        window.location.href = '/dashboard';
    }

    function handleSkip() {
        // Go as SUPERADMIN — no impersonation
        persistAndGo(UserRole.SUPERADMIN);
        window.location.href = '/dashboard';
    }

    return (
        <div
            className="min-h-screen flex flex-col"
            style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text-primary)' }}
        >
            {/* Top bar */}
            <div
                className="flex items-center justify-between px-6 py-3 border-b"
                style={{ borderColor: 'var(--os-border)' }}
            >
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full os-dot-online animate-blink" />
                    <span className="text-xs font-bold text-[#00D97E] tracking-widest uppercase">
                        Online — Secure Node
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    {(['EN', 'FR', 'SO', 'AR'] as const).map((l) => (
                        <button key={l} className="text-xs font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors px-1">{l}</button>
                    ))}
                </div>
            </div>

            {/* Main */}
            <div className="flex-1 flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-3xl">
                    {/* Auth success badge */}
                    <div className="flex items-center justify-center gap-2 mb-6">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[rgba(0,217,126,0.1)] border border-[#00D97E]/20">
                            <CheckCircle className="w-4 h-4 text-[#00D97E]" />
                            <span className="text-xs font-semibold uppercase tracking-widest text-[#00D97E]">
                                Superadmin Authentication
                            </span>
                        </div>
                    </div>

                    <h1 className="text-3xl font-bold text-center mb-1">
                        Bienvenue,{' '}
                        <span className="text-[#F97316]">Superadmin</span>
                    </h1>
                    <p className="text-center text-sm text-[var(--os-text-muted)] mb-2">
                        Vous pouvez tester la plateforme en tant qu&apos;un autre rôle, ou accéder directement au dashboard complet.
                    </p>

                    {/* Skip button — prominent */}
                    <div className="flex justify-center mb-6">
                        <button
                            onClick={handleSkip}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:bg-[rgba(249,115,22,0.12)]"
                            style={{
                                color: '#F97316',
                                border: '1px solid rgba(249,115,22,0.3)',
                                backgroundColor: 'rgba(249,115,22,0.06)',
                            }}
                        >
                            <SkipForward className="w-4 h-4" />
                            Ignorer — accéder en Superadmin
                            <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {/* Impersonation card */}
                    <div
                        className="rounded-2xl p-6 border"
                        style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}
                    >
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Left: Role picker */}
                            <div className="lg:col-span-2 flex flex-col gap-6">
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <h2 className="text-sm font-semibold text-[var(--os-text-primary)] flex items-center gap-2">
                                            <Eye className="w-4 h-4 text-[#F59E0B]" />
                                            Tester un rôle
                                        </h2>
                                        <span className="text-[10px] text-[var(--os-text-muted)] uppercase tracking-widest">
                                            Impersonation mode
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        {IMPERSONATION_ROLES.map((role) => {
                                            const isSelected = selectedRole === role.key;
                                            return (
                                                <button
                                                    key={role.key}
                                                    onClick={() => setSelectedRole(role.key)}
                                                    className={`
                                                        relative p-3 rounded-xl border text-left transition-all cursor-pointer
                                                        ${isSelected
                                                            ? 'border-opacity-40'
                                                            : 'border-[var(--os-border)] hover:border-[var(--os-border-strong)] bg-[var(--os-surface-2)]'
                                                        }
                                                    `}
                                                    style={isSelected ? {
                                                        backgroundColor: `${role.color}12`,
                                                        borderColor: `${role.color}50`,
                                                    } : undefined}
                                                >
                                                    <div className="mb-2" style={{ color: isSelected ? role.color : 'var(--os-text-muted)' }}>
                                                        {role.icon}
                                                    </div>
                                                    <p className="text-xs font-semibold text-[var(--os-text-primary)] mb-0.5">{role.title}</p>
                                                    <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed mb-2">{role.description}</p>
                                                    <span
                                                        className="inline-block text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md"
                                                        style={{
                                                            backgroundColor: `${role.color}18`,
                                                            color: role.color,
                                                        }}
                                                    >
                                                        {role.accessLevel}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Operational Site */}
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <h2 className="text-sm font-semibold text-[var(--os-text-primary)] flex items-center gap-2">
                                            <MapPin className="w-4 h-4 text-[#F59E0B]" />
                                            Site opérationnel
                                        </h2>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        {SITES.map((site) => {
                                            const isSelected = selectedSite === site.key;
                                            return (
                                                <button
                                                    key={site.key}
                                                    onClick={() => setSelectedSite(site.key)}
                                                    className={`
                                                        flex items-center justify-between p-3 rounded-xl border text-left transition-all
                                                        ${isSelected
                                                            ? 'bg-[rgba(56,189,248,0.06)] border-[#38BDF8]/25'
                                                            : 'border-[var(--os-border)] hover:border-[var(--os-border-strong)] bg-[var(--os-surface-2)]'
                                                        }
                                                    `}
                                                >
                                                    <div>
                                                        <p className="text-xs font-semibold text-[var(--os-text-primary)]">{site.name}</p>
                                                        <p className="text-[10px] text-[var(--os-text-muted)] flex items-center gap-1 mt-0.5">
                                                            <MapPin className="w-2.5 h-2.5 text-[#F59E0B]" />
                                                            {site.coords}
                                                        </p>
                                                    </div>
                                                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors ${
                                                        isSelected ? 'border-[#38BDF8] bg-[#38BDF8]' : 'border-[var(--os-border-strong)]'
                                                    }`} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {/* Right: Info panel */}
                            <div className="flex flex-col gap-4">
                                <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">Mode Impersonation</h2>

                                <div
                                    className="p-3 rounded-xl"
                                    style={{ backgroundColor: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)' }}
                                >
                                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--os-text-muted)' }}>
                                        En tant que <strong className="text-[#F97316]">Superadmin</strong>, vous pouvez visualiser
                                        la plateforme comme n&apos;importe quel rôle pour vérifier les permissions et l&apos;expérience utilisateur.
                                    </p>
                                </div>

                                <div
                                    className="p-3 rounded-xl"
                                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                                >
                                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--os-text-muted)' }}>
                                        Votre session
                                    </p>
                                    <div className="flex flex-col gap-1.5 text-[11px]">
                                        <div className="flex justify-between">
                                            <span style={{ color: 'var(--os-text-muted)' }}>Rôle réel</span>
                                            <span className="font-semibold text-[#F97316]">SUPERADMIN</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span style={{ color: 'var(--os-text-muted)' }}>Accès</span>
                                            <span className="font-semibold" style={{ color: 'var(--os-text-primary)' }}>Complet</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span style={{ color: 'var(--os-text-muted)' }}>Audit</span>
                                            <span className="font-semibold text-emerald-400">Activé</span>
                                        </div>
                                    </div>
                                </div>

                                {selectedRole && (
                                    <div
                                        className="p-3 rounded-xl animate-in fade-in duration-200"
                                        style={{ backgroundColor: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)' }}
                                    >
                                        <p className="text-[10px] font-semibold text-[#38BDF8] uppercase tracking-widest mb-1">
                                            Prévisualisation
                                        </p>
                                        <p className="text-[11px]" style={{ color: 'var(--os-text-muted)' }}>
                                            Vous verrez le dashboard comme un <strong style={{ color: 'var(--os-text-primary)' }}>{
                                                IMPERSONATION_ROLES.find((r) => r.key === selectedRole)?.title
                                            }</strong>. Vos actions seront journalisées sous votre identité Superadmin.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Launch button */}
                        <div className="flex items-center justify-end mt-6 pt-4 border-t" style={{ borderColor: 'var(--os-border)' }}>
                            <OsButton
                                variant="primary"
                                size="lg"
                                loading={loading}
                                disabled={!selectedRole}
                                icon={!loading ? <Rocket className="w-4 h-4" /> : undefined}
                                onClick={handleLaunch}
                            >
                                {selectedRole
                                    ? `Lancer en tant que ${IMPERSONATION_ROLES.find((r) => r.key === selectedRole)?.title}`
                                    : 'Sélectionnez un rôle'}
                            </OsButton>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom bar */}
            <div
                className="flex items-center justify-between px-6 py-2 text-[10px] text-[var(--os-text-muted)] border-t"
                style={{ borderColor: 'var(--os-border)' }}
            >
                <span>© 2025 Government of Somaliland</span>
                <div className="flex items-center gap-4">
                    <span>⬛ BER-DC1</span>
                    <span>⚡ v1.2.4-secure</span>
                    <span>🔒 AES-256</span>
                </div>
            </div>
        </div>
    );
}
