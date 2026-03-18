'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowRight, Shield } from 'lucide-react';

export function HeroSection() {
    const t = useTranslations('Landing');
    const c = useTranslations('Common');

    return (
        <section className="relative pt-24 sm:pt-28 md:pt-32 pb-16 sm:pb-32 px-3 sm:px-6 overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            {/* Background decorative gradients */}
            <div className="absolute top-0 left-1/4 w-[300px] sm:w-[500px] lg:w-[600px] h-[300px] sm:h-[500px] lg:h-[600px] bg-emerald-900/15 rounded-full blur-[150px]" />
            <div className="absolute bottom-0 right-1/4 w-[200px] sm:w-[300px] lg:w-[400px] h-[200px] sm:h-[300px] lg:h-[400px] bg-yellow-900/10 rounded-full blur-[120px]" />

            {/* Grid pattern overlay */}
            <div
                className="absolute inset-0 opacity-[0.03]"
                style={{
                    backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                    backgroundSize: '60px 60px',
                }}
            />

            <div className="max-w-7xl mx-auto text-center relative z-10">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-8">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    {t('badge')}
                </div>

                {/* Main Title */}
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
                    <span style={{ color: 'var(--ais-page-text)' }}>{t('hero_title_line1')}</span>
                    <br />
                    <span className="bg-gradient-to-r from-emerald-400 via-emerald-300 to-yellow-400 bg-clip-text text-transparent">
                        {t('hero_title_line2')}
                    </span>
                </h1>

                {/* Subtitle */}
                <p className="text-sm sm:text-base md:text-lg mb-8 sm:mb-10 leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('hero_subtitle')}
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                    <Link href="/login" className="w-full sm:w-auto px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold transition-all hover:scale-105 hover:shadow-[0_0_25px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2 group" style={{ color: '#FFFFFF' }}>
                        {c('sign_in_portal')}
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <Link href="/signup" className="w-full sm:w-auto px-8 py-3.5 bg-transparent rounded-xl font-semibold transition-all flex items-center justify-center gap-2" style={{ color: 'var(--ais-page-text-secondary)', border: '1px solid var(--ais-page-border)' }}>
                        <Shield className="w-4 h-4 text-emerald-500" />
                        {c('request_access')}
                    </Link>
                </div>

                {/* Trusted By */}
                <div className="flex flex-col items-center gap-4">
                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('trusted_by')}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6">
                        {/* Partner logo placeholders */}
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="h-6 w-12 sm:h-8 sm:w-16 rounded-md" style={{ backgroundColor: 'var(--ais-page-surface)', border: '1px solid var(--ais-page-border)' }} />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
