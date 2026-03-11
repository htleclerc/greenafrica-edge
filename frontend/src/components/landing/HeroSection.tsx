'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowRight, Shield } from 'lucide-react';

export function HeroSection() {
    const t = useTranslations('Landing');
    const c = useTranslations('Common');

    return (
        <section className="relative pt-28 pb-32 px-6 overflow-hidden bg-[#0A1110]">
            {/* Background decorative gradients */}
            <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-emerald-900/15 rounded-full blur-[150px]" />
            <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-yellow-900/10 rounded-full blur-[120px]" />

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
                <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
                    <span className="text-white">{t('hero_title_line1')}</span>
                    <br />
                    <span className="bg-gradient-to-r from-emerald-400 via-emerald-300 to-yellow-400 bg-clip-text text-transparent">
                        {t('hero_title_line2')}
                    </span>
                </h1>

                {/* Subtitle */}
                <p className="text-base md:text-lg text-slate-400 mb-10 leading-relaxed max-w-2xl mx-auto">
                    {t('hero_subtitle')}
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                    <Link href="/login" className="w-full sm:w-auto px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-all hover:scale-105 hover:shadow-[0_0_25px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2 group">
                        {c('sign_in_portal')}
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <Link href="/signup" className="w-full sm:w-auto px-8 py-3.5 bg-transparent hover:bg-white/5 border border-slate-700 hover:border-slate-500 text-slate-300 rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                        <Shield className="w-4 h-4 text-emerald-500" />
                        {c('request_access')}
                    </Link>
                </div>

                {/* Trusted By */}
                <div className="flex flex-col items-center gap-4">
                    <p className="text-[10px] font-bold tracking-[0.2em] text-slate-600 uppercase">
                        {t('trusted_by')}
                    </p>
                    <div className="flex items-center gap-6">
                        {/* Partner logo placeholders */}
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="h-8 w-16 bg-slate-800/50 rounded-md border border-slate-800" />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
