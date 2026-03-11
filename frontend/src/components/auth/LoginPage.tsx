'use client';

import * as React from 'react';
import { Shield, Clock, Eye, EyeOff, ArrowRight, AlertCircle, Zap, ChevronRight } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { DEMO_PROFILES } from '@/mock/datas/testProfiles';
import { UserRole } from '@/types/secure';
import { createClient } from '@/lib/supabase/client';

function persistDemoRole(role: UserRole) {
    document.cookie = `demo_active=true; path=/; max-age=3600; SameSite=Lax`;
    document.cookie = `demo_role=${role}; path=/; max-age=3600; SameSite=Lax`;
    localStorage.setItem('demo_active', 'true');
    localStorage.setItem('demo_role', role);
}

function clearDemoFlags() {
    document.cookie = 'demo_active=; path=/; max-age=0';
    document.cookie = 'demo_role=; path=/; max-age=0';
    localStorage.removeItem('demo_active');
    localStorage.removeItem('demo_role');
}

function enterDemo(role: UserRole) {
    persistDemoRole(role);
    window.location.href = '/dashboard';
}

export function LoginPage() {
    const [email, setEmail]       = React.useState('');
    const [password, setPassword] = React.useState('');
    const [showPwd, setShowPwd]   = React.useState(false);
    const [loading, setLoading]   = React.useState(false);
    const [error, setError]       = React.useState('');
    const [showDemo, setShowDemo] = React.useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        if (!email || !password) {
            setError('Veuillez renseigner vos identifiants.');
            return;
        }

        setLoading(true);

        // Clear any leftover demo flags
        clearDemoFlags();

        // Real Supabase Auth
        const supabase = createClient();
        const { data, error: authError } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
        });

        if (authError || !data.user) {
            setError(
                authError?.message === 'Invalid login credentials'
                    ? 'Identifiants incorrects. Vérifiez votre email et mot de passe.'
                    : authError?.message ?? 'Erreur de connexion. Réessayez.'
            );
            setLoading(false);
            return;
        }

        // Fetch the user's profile to get their role
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, is_active')
            .eq('id', data.user.id)
            .single();

        if (profile && !profile.is_active) {
            await supabase.auth.signOut();
            setError('Ce compte est désactivé. Contactez votre administrateur.');
            setLoading(false);
            return;
        }

        const role = (profile?.role as UserRole) ?? UserRole.PORT_OFFICER;

        // SUPERADMIN → post-login to optionally impersonate another role
        if (role === UserRole.SUPERADMIN) {
            window.location.href = '/post-login';
        } else {
            window.location.href = '/dashboard';
        }
    }

    return (
        <div
            className="min-h-screen flex flex-col"
            style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text-primary)' }}
        >
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--os-border)' }}>
                <a href="/" className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
                            <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" />
                        </svg>
                    </div>
                    <span className="text-sm font-bold" style={{ color: 'var(--os-text-primary)' }}>AIS Portal</span>
                </a>
                <div className="flex items-center gap-3">
                    {(['FR', 'EN', 'SO'] as const).map((lang) => (
                        <button
                            key={lang}
                            className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors ${
                                lang === 'FR'
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : 'text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]'
                            }`}
                        >
                            {lang}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main */}
            <div className="flex-1 flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md flex flex-col items-center">
                    {/* Logo */}
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mb-5 shadow-[0_0_24px_rgba(16,185,129,0.1)]">
                        <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7">
                            <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" fill="#10B981" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--os-text-primary)' }}>AIS Portal</h1>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500/60 mb-8">
                        Africgreen Initiative · Somaliland
                    </p>

                    {/* Login card */}
                    <div
                        className="w-full rounded-2xl p-6 border"
                        style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}
                    >
                        {/* Warning */}
                        <div
                            className="flex gap-3 p-3 rounded-xl mb-4"
                            style={{ backgroundColor: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)' }}
                        >
                            <Shield className="w-4 h-4 text-[var(--os-yellow)] flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide mb-0.5 text-[var(--os-yellow)]">
                                    Système officiel du gouvernement
                                </p>
                                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--os-text-muted)' }}>
                                    Accès réservé au personnel autorisé. Toutes les activités sont enregistrées.
                                </p>
                            </div>
                        </div>

                        {/* Session notice */}
                        <div
                            className="flex items-center gap-2 px-3 py-2 rounded-lg mb-5"
                            style={{ backgroundColor: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}
                        >
                            <Clock className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                            <p className="text-[11px] text-emerald-400">Session expire après 15 minutes d&apos;inactivité.</p>
                        </div>

                        {/* Form — no role selector, role is auto-detected from the account */}
                        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                                    Email / Identifiant gouvernemental
                                </label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="officer.name@berbera.gov.sl"
                                    className="w-full h-11 px-4 rounded-xl text-sm outline-none transition-all"
                                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                    <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                                        Mot de passe
                                    </label>
                                    <a href="#" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Oublié ?</a>
                                </div>
                                <div className="relative">
                                    <input
                                        type={showPwd ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••••••"
                                        className="w-full h-11 pl-4 pr-10 rounded-xl text-sm outline-none transition-all"
                                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPwd((p) => !p)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                                        style={{ color: 'var(--os-text-muted)' }}
                                    >
                                        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                    <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                                    <p className="text-xs text-red-400">{error}</p>
                                </div>
                            )}

                            <OsButton
                                type="submit"
                                variant="primary"
                                size="lg"
                                loading={loading}
                                iconRight={!loading ? <ArrowRight className="w-4 h-4" /> : undefined}
                                className="w-full mt-1"
                            >
                                Accéder à la plateforme
                            </OsButton>
                        </form>

                        <p className="text-center text-xs mt-4" style={{ color: 'var(--os-text-muted)' }}>
                            Pas encore de compte ?{' '}
                            <a href="/signup" className="text-emerald-400 hover:underline font-semibold">Demander un accès →</a>
                        </p>
                    </div>

                    {/* ── Demo mode section ───────────────────────────────── */}
                    <div className="w-full mt-4">
                        <button
                            onClick={() => setShowDemo((v) => !v)}
                            className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all"
                            style={{
                                backgroundColor: showDemo ? 'rgba(234,179,8,0.08)' : 'var(--os-surface)',
                                border: showDemo ? '1px solid rgba(234,179,8,0.3)' : '1px solid var(--os-border)',
                                color: showDemo ? '#EAB308' : 'var(--os-text-muted)',
                            }}
                        >
                            <div className="flex items-center gap-2">
                                <Zap className="w-4 h-4" />
                                <span>Mode Démo — explorer sans compte</span>
                            </div>
                            <ChevronRight
                                className="w-4 h-4 transition-transform"
                                style={{ transform: showDemo ? 'rotate(90deg)' : 'rotate(0deg)' }}
                            />
                        </button>

                        {showDemo && (
                            <div
                                className="mt-2 rounded-xl p-4"
                                style={{ backgroundColor: 'var(--os-surface)', border: '1px solid rgba(234,179,8,0.2)' }}
                            >
                                <p className="text-[11px] mb-3" style={{ color: 'var(--os-text-muted)' }}>
                                    Choisissez un profil pour explorer la plateforme avec des données de démonstration. Aucun compte requis.
                                </p>
                                <div className="flex flex-col gap-2">
                                    {DEMO_PROFILES.map((p) => (
                                        <button
                                            key={p.role}
                                            onClick={() => enterDemo(p.role)}
                                            className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-left transition-all group"
                                            style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                                        >
                                            <div
                                                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
                                                style={{ backgroundColor: p.color }}
                                            >
                                                {p.label.charAt(0)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold" style={{ color: 'var(--os-text-primary)' }}>
                                                    {p.label}
                                                </p>
                                                <p className="text-[11px] truncate" style={{ color: 'var(--os-text-muted)' }}>
                                                    {p.description}
                                                </p>
                                            </div>
                                            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: p.color }} />
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[10px] mt-3 text-center" style={{ color: 'var(--os-text-muted)' }}>
                                    Les données démo sont fictives et réinitialisées à chaque session.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-6 mt-5 text-[11px]" style={{ color: 'var(--os-text-muted)' }}>
                        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 transition-colors">Confidentialité</a>
                        <span>·</span>
                        <a href="/terms-of-service" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 transition-colors">CGU</a>
                        <span>·</span>
                        <a href="/security-audit" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 transition-colors">Sécurité</a>
                    </div>
                </div>
            </div>

            <div
                className="flex items-center justify-between px-6 py-2 text-[10px] border-t"
                style={{ borderColor: 'var(--os-border)', color: 'var(--os-text-muted)' }}
            >
                <span>© 2025 Gouvernement de Somaliland</span>
                <div className="flex items-center gap-4">
                    <span>🌿 IMO DCS Certifiée</span>
                    <span>🔒 AES-256</span>
                </div>
            </div>
        </div>
    );
}
