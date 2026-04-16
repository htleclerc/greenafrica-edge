'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Mail, ArrowLeft, ArrowRight, CheckCircle, AlertCircle, Shield } from 'lucide-react';
import { AfricGreenLogo } from '@/components/ui/AfricGreenLogo';
import { OsButton } from '@/components/ui/OsButton';
import { createClient } from '@/lib/supabase/client';

export function ForgotPasswordPage() {
    const t = useTranslations('Auth');
    const [email, setEmail] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');
    const [sent, setSent] = React.useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');

        if (!email.trim()) {
            setError(t('forgot_error_empty'));
            return;
        }

        setLoading(true);

        const supabase = createClient();
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
            email.trim(),
            { redirectTo: `${window.location.origin}/auth/callback?type=recovery` }
        );

        setLoading(false);

        if (resetError) {
            setError(t('forgot_error_generic'));
            return;
        }

        setSent(true);
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
                    <div className="mb-5 shadow-[0_0_24px_rgba(16,185,129,0.1)]">
                        <AfricGreenLogo size={56} variant="dark" className="rounded-2xl" />
                    </div>
                    <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--os-text-primary)' }}>
                        {t('forgot_title')}
                    </h1>
                    <p className="text-xs text-center max-w-xs mb-8" style={{ color: 'var(--os-text-muted)' }}>
                        {t('forgot_subtitle')}
                    </p>

                    {/* Card */}
                    <div
                        className="w-full rounded-xl sm:rounded-2xl p-4 sm:p-6 border"
                        style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}
                    >
                        {sent ? (
                            /* ── Success state ─────────────────────────────── */
                            <div className="flex flex-col items-center text-center py-4">
                                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
                                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                                </div>
                                <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--os-text-primary)' }}>
                                    {t('forgot_sent_title')}
                                </h2>
                                <p className="text-sm mb-1" style={{ color: 'var(--os-text-muted)' }}>
                                    {t('forgot_sent_desc')}
                                </p>
                                <p className="text-sm font-semibold text-emerald-400 mb-6">{email}</p>

                                <div
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg w-full mb-6"
                                    style={{ backgroundColor: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)' }}
                                >
                                    <Shield className="w-3.5 h-3.5 text-[var(--os-yellow)] flex-shrink-0" />
                                    <p className="text-[11px]" style={{ color: 'var(--os-text-muted)' }}>
                                        {t('forgot_sent_check_spam')}
                                    </p>
                                </div>

                                <a
                                    href="/login"
                                    className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-semibold"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                    {t('forgot_back_to_login')}
                                </a>
                            </div>
                        ) : (
                            /* ── Form state ────────────────────────────────── */
                            <>
                                <div
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg mb-5"
                                    style={{ backgroundColor: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}
                                >
                                    <Mail className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                                    <p className="text-[11px] text-emerald-400">{t('forgot_info')}</p>
                                </div>

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
                                        {t('forgot_btn_send')}
                                    </OsButton>
                                </form>

                                <p className="text-center text-xs mt-4" style={{ color: 'var(--os-text-muted)' }}>
                                    <a href="/login" className="text-emerald-400 hover:underline font-semibold flex items-center justify-center gap-1">
                                        <ArrowLeft className="w-3 h-3" />
                                        {t('forgot_back_to_login')}
                                    </a>
                                </p>
                            </>
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
