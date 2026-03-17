'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Clock, ArrowLeft, Mail, Shield, CheckCircle } from 'lucide-react';

export function PendingApprovalPage() {
    const t = useTranslations('Auth');

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
                    <span className="text-sm font-bold" style={{ color: 'var(--os-text-primary)' }}>{t('ais_portal')}</span>
                </a>
            </div>

            {/* Main */}
            <div className="flex-1 flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-lg flex flex-col items-center">
                    {/* Icon */}
                    <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 border border-yellow-500/25 flex items-center justify-center mb-6 shadow-[0_0_24px_rgba(234,179,8,0.1)]">
                        <Clock className="w-8 h-8 text-yellow-400" />
                    </div>

                    <h1 className="text-2xl font-bold mb-2 text-center" style={{ color: 'var(--os-text-primary)' }}>
                        {t('pending_title')}
                    </h1>
                    <p className="text-sm text-center max-w-md mb-8" style={{ color: 'var(--os-text-muted)' }}>
                        {t('pending_subtitle')}
                    </p>

                    {/* Status card */}
                    <div
                        className="w-full rounded-2xl p-4 sm:p-6 border"
                        style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}
                    >
                        {/* Steps */}
                        <div className="flex flex-col gap-2 sm:gap-3">
                            {/* Step 1 — completed */}
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--os-text-primary)' }}>
                                        {t('pending_step1_title')}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>
                                        {t('pending_step1_desc')}
                                    </p>
                                </div>
                            </div>

                            {/* Step 2 — completed */}
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <Mail className="w-4 h-4 text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--os-text-primary)' }}>
                                        {t('pending_step2_title')}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>
                                        {t('pending_step2_desc')}
                                    </p>
                                </div>
                            </div>

                            {/* Step 3 — in progress */}
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-yellow-500/15 flex items-center justify-center flex-shrink-0 mt-0.5 relative">
                                    <Shield className="w-4 h-4 text-yellow-400" />
                                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-yellow-400 rounded-full animate-pulse" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: '#EAB308' }}>
                                        {t('pending_step3_title')}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>
                                        {t('pending_step3_desc')}
                                    </p>
                                </div>
                            </div>

                            {/* Step 4 — pending */}
                            <div className="flex items-start gap-3 opacity-40">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ border: '1px dashed var(--os-border)' }}>
                                    <span className="text-xs font-bold" style={{ color: 'var(--os-text-muted)' }}>4</span>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--os-text-primary)' }}>
                                        {t('pending_step4_title')}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>
                                        {t('pending_step4_desc')}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Info box */}
                        <div
                            className="flex gap-3 p-3 rounded-xl mt-6"
                            style={{ backgroundColor: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)' }}
                        >
                            <Shield className="w-4 h-4 text-[var(--os-yellow)] flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide mb-0.5 text-[var(--os-yellow)]">
                                    {t('pending_info_title')}
                                </p>
                                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--os-text-muted)' }}>
                                    {t('pending_info_desc')}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Back to login */}
                    <a
                        href="/login"
                        className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-semibold mt-6"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        {t('forgot_back_to_login')}
                    </a>
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
