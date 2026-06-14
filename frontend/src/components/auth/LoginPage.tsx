'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Shield, Clock, Eye, EyeOff, ArrowRight, AlertCircle, Zap, ChevronRight } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { DEMO_PROFILES } from '@/mock/datas/testProfiles';
import { UserRole } from '@/types/secure';
import { createClient } from '@/lib/supabase/client';
import { loginDestination } from '@/lib/auth/loginDestination';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { AfricGreenLogo } from '@/components/ui/AfricGreenLogo';

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

        // Detect operator (shipowners row) — own-row read is allowed by RLS.
        const { data: shipowner } = await supabase
            .from('shipowners')
            .select('id')
            .eq('profile_id', data.user.id)
            .maybeSingle();
        const isOperator = !!shipowner;

        // Staff role (profiles row may be absent for pure operators).
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, is_active')
            .eq('id', data.user.id)
            .maybeSingle();

        // Inactive staff (not operators) await approval.
        if (!isOperator && profile && !profile.is_active) {
            await supabase.auth.signOut();
            window.location.href = '/pending-approval';
            return;
        }

        const role = (profile?.role as UserRole) ?? null;
        window.location.href = loginDestination({ isOperator, role });
    }

    return (
        <div
            className="min-h-screen flex flex-col"
            style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text-primary)' }}
        >
            {/* Top bar — same h-16 as public Navbar */}
            <div className="border-b" style={{ borderColor: 'var(--os-border)' }}>
                <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between">
                    {/* Logo — home link */}
                    <a href="/" className="flex items-center gap-2 flex-shrink-0">
                        <AfricGreenLogo size={32} variant="dark" className="flex-shrink-0 rounded-lg" />
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
            </div>

            {/* Main */}
            <div className="flex-1 flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md flex flex-col items-center">
                    {/* Logo */}
                    <div className="mb-5 shadow-[0_0_24px_rgba(16,185,129,0.1)]">
                        <AfricGreenLogo size={56} variant="dark" className="rounded-2xl" />
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
                                        className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-lg transition-colors"
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

                    {/* Quick Demo Access (Conditional) */}
                    {process.env.NEXT_PUBLIC_DEMO_ALLOWED === 'true' && (
                        <div className="w-full mt-8 pt-8 border-t border-slate-700/50">
                            <button
                                onClick={() => setShowDemo((v) => !v)}
                                className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all group"
                                style={{ 
                                    backgroundColor: showDemo ? 'rgba(234,179,8,0.08)' : 'rgba(30, 41, 59, 0.5)',
                                    border: showDemo ? '1px solid rgba(234,179,8,0.3)' : '1px solid var(--os-border)',
                                    color: showDemo ? '#EAB308' : 'var(--os-text-muted)'
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    <Zap className={`w-4 h-4 ${showDemo ? 'text-yellow-500' : 'text-slate-400'}`} />
                                    <span className={showDemo ? '' : 'group-hover:text-slate-200 transition-colors'}>
                                        {t('demo_title')}
                                    </span>
                                </div>
                                <ChevronRight 
                                    className="w-4 h-4 transition-transform duration-300"
                                    style={{ transform: showDemo ? 'rotate(90deg)' : 'rotate(0deg)' }} 
                                />
                            </button>

                            {showDemo && (
                                <div 
                                    className="mt-4 rounded-xl p-5 border border-slate-700/50 bg-slate-800/40 backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-300"
                                >
                                    <div className="flex items-center gap-2 mb-4">
                                        <div className="h-4 w-1 bg-yellow-500 rounded-full" />
                                        <h3 className="text-[11px] font-bold tracking-widest text-slate-400 uppercase">
                                            {t('demo_choose_profile')}
                                        </h3>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 gap-3">
                                        {DEMO_PROFILES.map((profile) => (
                                            <button
                                                key={profile.role}
                                                onClick={() => enterDemo(profile.role)}
                                                className="group relative flex items-center gap-4 p-4 rounded-xl border border-slate-700/50 bg-slate-800/60 hover:bg-slate-700/60 hover:border-yellow-500/30 transition-all duration-300"
                                            >
                                                <div 
                                                    className="h-10 w-10 min-w-[40px] rounded-lg flex items-center justify-center text-white font-bold"
                                                    style={{ backgroundColor: profile.color }}
                                                >
                                                    {profile.label.charAt(0)}
                                                </div>
                                                
                                                <div className="flex-1 text-left min-w-0">
                                                    <div className="text-sm font-semibold text-white group-hover:text-yellow-400 transition-colors">
                                                        {profile.label}
                                                    </div>
                                                    <div className="text-[11px] text-slate-400 truncate">
                                                        {profile.description}
                                                    </div>
                                                </div>

                                                <ArrowRight 
                                                    size={16} 
                                                    className="text-slate-500 group-hover:text-yellow-400 group-hover:translate-x-1 transition-all" 
                                                />
                                            </button>
                                        ))}
                                    </div>
                                    
                                    <div className="mt-5 flex items-start gap-2 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/10">
                                        <AlertCircle size={14} className="text-yellow-500/70 mt-0.5 flex-shrink-0" />
                                        <p className="text-[10px] leading-relaxed text-slate-400 italic">
                                            {t('demo_disclaimer')}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex items-center flex-wrap gap-3 sm:gap-6 mt-5 text-[11px]" style={{ color: 'var(--os-text-muted)' }}>
                        <a href="/privacy-policy?from=auth" className="hover:text-emerald-400 transition-colors">{t('link_privacy')}</a>
                        <span>·</span>
                        <a href="/terms-of-service?from=auth" className="hover:text-emerald-400 transition-colors">{t('link_terms')}</a>
                        <span>·</span>
                        <a href="/security-audit?from=auth" className="hover:text-emerald-400 transition-colors">{t('link_security')}</a>
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
