'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Eye, EyeOff, ArrowRight, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { AfricGreenLogo } from '@/components/ui/AfricGreenLogo';
import { OsButton } from '@/components/ui/OsButton';
import { createClient } from '@/lib/supabase/client';

const MIN_PASSWORD_LENGTH = 8;

function PasswordStrength({ password }: { password: string }) {
    const t = useTranslations('Auth');
    const checks = [
        { label: t('reset_rule_length'), ok: password.length >= MIN_PASSWORD_LENGTH },
        { label: t('reset_rule_uppercase'), ok: /[A-Z]/.test(password) },
        { label: t('reset_rule_number'), ok: /\d/.test(password) },
        { label: t('reset_rule_special'), ok: /[^A-Za-z0-9]/.test(password) },
    ];

    return (
        <div className="flex flex-col gap-1.5 mt-1">
            {checks.map((c) => (
                <div key={c.label} className="flex items-center gap-2">
                    <div
                        className="w-3 h-3 rounded-full flex items-center justify-center"
                        style={{
                            backgroundColor: c.ok ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
                            border: c.ok ? '1px solid rgba(16,185,129,0.4)' : '1px solid var(--os-border)',
                        }}
                    >
                        {c.ok && <CheckCircle className="w-2 h-2 text-emerald-400" />}
                    </div>
                    <span className="text-[11px]" style={{ color: c.ok ? '#10B981' : 'var(--os-text-muted)' }}>
                        {c.label}
                    </span>
                </div>
            ))}
        </div>
    );
}

export function ResetPasswordPage() {
    const t = useTranslations('Auth');
    const [password, setPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [showPwd, setShowPwd] = React.useState(false);
    const [showConfirm, setShowConfirm] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');
    const [success, setSuccess] = React.useState(false);

    const isValid =
        password.length >= MIN_PASSWORD_LENGTH &&
        /[A-Z]/.test(password) &&
        /\d/.test(password) &&
        /[^A-Za-z0-9]/.test(password) &&
        password === confirmPassword;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError(t('reset_error_mismatch'));
            return;
        }

        if (!isValid) {
            setError(t('reset_error_weak'));
            return;
        }

        setLoading(true);

        const supabase = createClient();
        const { error: updateError } = await supabase.auth.updateUser({ password });

        setLoading(false);

        if (updateError) {
            setError(updateError.message);
            return;
        }

        setSuccess(true);
    }

    return (
        <div
            className="min-h-screen flex flex-col"
            style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text-primary)' }}
        >
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--os-border)' }}>
                <a href="/" className="flex items-center gap-2">
                    <AfricGreenLogo size={28} variant="dark" className="rounded-lg" />
                    <span className="text-sm font-bold" style={{ color: 'var(--os-text-primary)' }}>{t('ais_portal')}</span>
                </a>
            </div>

            {/* Main */}
            <div className="flex-1 flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md flex flex-col items-center">
                    {/* Logo */}
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mb-5 shadow-[0_0_24px_rgba(16,185,129,0.1)]">
                        <Lock className="w-7 h-7 text-emerald-400" />
                    </div>
                    <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--os-text-primary)' }}>
                        {t('reset_title')}
                    </h1>
                    <p className="text-xs text-center max-w-xs mb-8" style={{ color: 'var(--os-text-muted)' }}>
                        {t('reset_subtitle')}
                    </p>

                    {/* Card */}
                    <div
                        className="w-full rounded-2xl p-4 sm:p-6 border"
                        style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}
                    >
                        {success ? (
                            /* ── Success state ─────────────────────────────── */
                            <div className="flex flex-col items-center text-center py-4">
                                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
                                    <ShieldCheck className="w-6 h-6 text-emerald-400" />
                                </div>
                                <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--os-text-primary)' }}>
                                    {t('reset_success_title')}
                                </h2>
                                <p className="text-sm mb-6" style={{ color: 'var(--os-text-muted)' }}>
                                    {t('reset_success_desc')}
                                </p>
                                <OsButton
                                    variant="primary"
                                    size="lg"
                                    className="w-full"
                                    iconRight={<ArrowRight className="w-4 h-4" />}
                                    onClick={() => { window.location.href = '/login'; }}
                                >
                                    {t('reset_btn_go_login')}
                                </OsButton>
                            </div>
                        ) : (
                            /* ── Form state ────────────────────────────────── */
                            <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:gap-4">
                                {/* New password */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                                        {t('reset_label_new')}
                                    </label>
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
                                    {password && <PasswordStrength password={password} />}
                                </div>

                                {/* Confirm password */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                                        {t('reset_label_confirm')}
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showConfirm ? 'text' : 'password'}
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="••••••••••••"
                                            className="w-full h-11 pl-4 pr-10 rounded-xl text-sm outline-none transition-all"
                                            style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirm((p) => !p)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                                            style={{ color: 'var(--os-text-muted)' }}
                                        >
                                            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                    {confirmPassword && password !== confirmPassword && (
                                        <p className="text-[11px] text-red-400">{t('reset_error_mismatch')}</p>
                                    )}
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
                                    disabled={!isValid}
                                    iconRight={!loading ? <ArrowRight className="w-4 h-4" /> : undefined}
                                    className="w-full mt-1"
                                >
                                    {t('reset_btn_submit')}
                                </OsButton>
                            </form>
                        )}
                    </div>
                </div>
            </div>

            <div
                className="flex items-center justify-between px-6 py-2 text-[10px] border-t"
                style={{ borderColor: 'var(--os-border)', color: 'var(--os-text-muted)' }}
            >
                <span>{t('copyright')}</span>
                <div className="flex items-center gap-4">
                    <span>🌿 {t('badge_imo')}</span>
                    <span>🔒 {t('badge_aes')}</span>
                </div>
            </div>
        </div>
    );
}
