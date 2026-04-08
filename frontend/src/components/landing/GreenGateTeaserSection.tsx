'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Landmark, ArrowRight } from 'lucide-react';

export function GreenGateTeaserSection() {
    const t = useTranslations('Landing');

    return (
        <section className="relative py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6 overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            {/* Accent glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-yellow-900/8 rounded-full blur-[150px]" />

            <div className="max-w-4xl mx-auto relative z-10">
                <div
                    className="rounded-2xl p-8 sm:p-12 text-center hover:border-yellow-500/20 transition-all"
                    style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                >
                    <div className="w-14 h-14 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center mx-auto mb-6">
                        <Landmark className="w-7 h-7 text-yellow-400" />
                    </div>

                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-yellow-400 mb-3">{t('teaser_greengate_badge')}</p>
                    <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                        {t('teaser_greengate_title')}
                    </h2>
                    <p className="text-sm sm:text-base leading-relaxed mb-8 max-w-2xl mx-auto" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('teaser_greengate_desc')}
                    </p>

                    <Link
                        href="/partnership"
                        className="inline-flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold px-6 py-2.5 rounded-xl transition-all hover:shadow-[0_0_20px_rgba(234,179,8,0.3)]"
                    >
                        {t('teaser_greengate_cta')}
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        </section>
    );
}
