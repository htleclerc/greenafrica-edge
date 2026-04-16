'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Globe, ArrowRight } from 'lucide-react';

export function AboutVisionSection() {
    const t = useTranslations('About');

    return (
        <section className="relative py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6 overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            {/* Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-emerald-900/10 rounded-full blur-[180px]" />

            <div className="max-w-4xl mx-auto relative z-10 text-center">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-8">
                    <Globe className="w-8 h-8 text-emerald-400" />
                </div>

                <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400 mb-4">{t('vision_badge')}</p>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-6" style={{ color: 'var(--ais-page-text)' }}>
                    {t('vision_title')}
                </h2>
                <p className="text-sm sm:text-base leading-relaxed mb-6 max-w-2xl mx-auto" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('vision_desc')}
                </p>
                <p className="text-sm leading-relaxed mb-10 max-w-2xl mx-auto" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('vision_observatory')}
                </p>

                <Link
                    href="/partnership"
                    className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-8 py-3 rounded-xl transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                >
                    {t('vision_cta')}
                    <ArrowRight className="w-4 h-4" />
                </Link>
            </div>
        </section>
    );
}
