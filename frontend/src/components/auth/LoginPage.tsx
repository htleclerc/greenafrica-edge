'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Shield, Clock, Eye, EyeOff, ArrowRight, AlertCircle, Zap, ChevronRight } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { DEMO_PROFILES } from '@/mock/datas/testProfiles';
import { UserRole } from '@/types/secure';
import { createClient } from '@/lib/supabase/client';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';

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
    const t = useTranslations('Auth');
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
            setError(t('error_empty_credentials'));
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
            const msg = authError?.message ?? '';
            let displayError: string;
            if (msg === 'Invalid login credentials') {
                displayError = t('error_invalid_credentials');
            } else if (msg.includes('Database error') || msg.includes('unexpected_failure')) {
                displayError = t('error_database') ?? 'Service temporarily unavailable. Please try again in a few minutes.';
            } else {
                displayError = msg || t('error_connection');
            }
            setError(displayError);
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
            window.location.href = '/pending-approval';
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
            <div className="flex items-center justify-between px-3 sm:px-6 py-3 border-b" style={{ borderColor: 'var(--os-border)' }}>
                {/* Logo — home link */}
                <a href="/" className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0">
                        <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
                            <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" />
                        </svg>
                    </div>
                    <span className="text-sm font-bold auth-hide-mobile" style={{ color: 'var(--os-text-primary)' }}>{t('ais_portal')}</span>
                </a>
                {/* Online indicator — center (dot only on mobile) */}
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full os-dot-online animate-blink flex-shrink-0" />
                    <span className="text-xs font-semibold text-[#00D97E] tracking-widest uppercase auth-hide-mobile">{t('system_status_online')}</span>
                </div>
                {/* Locale switcher — right */}
                <LocaleSwitcher variant="dashboard" />
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
                    <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--os-text-primary)' }}>{t('ais_portal')}</h1>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500/60 mb-8">
                        {t('subtitle_initiative')}
                    </p>

                    {/* Login card */}
                    <div
                        className="w-full rounded-2xl p-4 sm:p-6 border"
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
                                    {t('gov_system_title')}
                                </p>
                                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--os-text-muted)' }}>
                                    {t('gov_system_warning')}
                                </p>
                            </div>
                        </div>

                        {/* Session notice */}
                        <div
                            className="flex items-center gap-2 px-3 py-2 rounded-lg mb-5"
                            style={{ backgroundColor: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}
                        >
                            <Clock className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                            <p className="text-[11px] text-emerald-400">{t('session_notice')}</p>
                        </div>

                        {/* Form — no role selector, role is auto-detected from the account */}
                        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                                    {t('label_email')}
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
                                        {t('label_password')}
                                    </label>
                                    <a href="/forgot-password" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">{t('forgot_password')}</a>
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
                                {t('btn_access_platform')}
                            </OsButton>
                        </form>

                        <p className="text-center text-xs mt-4" style={{ color: 'var(--os-text-muted)' }}>
                            {t('no_account')}{' '}
                            <a href="/signup" className="text-emerald-400 hover:underline font-semibold">{t('request_access')}</a>
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
                                <span>{t('demo_title')}</span>
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
                                    {t('demo_choose_profile')}
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
                                    {t('demo_disclaimer')}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center flex-wrap gap-3 sm:gap-6 mt-5 text-[11px]" style={{ color: 'var(--os-text-muted)' }}>
                        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 transition-colors">{t('link_privacy')}</a>
                        <span>·</span>
                        <a href="/terms-of-service" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 transition-colors">{t('link_terms')}</a>
                        <span>·</span>
                        <a href="/security-audit" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 transition-colors">{t('link_security')}</a>
                    </div>
                </div>
            </div>

            <div
                className="flex items-center justify-between px-6 py-2 text-[10px] border-t"
                style={{ borderColor: 'var(--os-border)', color: 'var(--os-text-muted)' }}
            >
                <span>{t('copyright')}</span>
                <div className="flex items-center gap-4">
                    <span>BER-DC1</span>
                    <span>v1.2.4-secure</span>
                    <span>AES-256</span>
                </div>
            </div>
        </div>
    );
}
