'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Building2, Shield, Leaf, ArrowRight } from 'lucide-react';

const PILLARS = [
    { icon: Building2, key: 'teaser_african', color: 'emerald' },
    { icon: Shield, key: 'teaser_blockchain', color: 'yellow' },
    { icon: Leaf, key: 'teaser_expertise', color: 'blue' },
];

export function AboutTeaserSection() {
    const t = useTranslations('Landing');

    return (
        <section className="py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    {/* Left — text */}
                    <div>
                        <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400 mb-3">{t('teaser_about_badge')}</p>
                        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                            {t('teaser_about_title')}
                        </h2>
                        <p className="text-sm sm:text-base leading-relaxed mb-8" style={{ color: 'var(--ais-page-text-muted)' }}>
                            {t('teaser_about_desc')}
                        </p>
                        <Link
                            href="/about"
                            className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm font-semibold transition-colors"
                        >
                            {t('teaser_about_cta')}
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>

                    {/* Right — 3 pillar cards */}
                    <div className="flex flex-col gap-4">
                        {PILLARS.map(({ icon: Icon, key, color }) => (
                            <div
                                key={key}
                                className="rounded-xl p-5 flex items-start gap-4 hover:border-emerald-500/20 transition-all"
                                style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                            >
                                <div className={`w-10 h-10 rounded-lg bg-${color}-500/10 flex items-center justify-center flex-shrink-0`}>
                                    <Icon className={`w-5 h-5 text-${color}-400`} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold mb-1" style={{ color: 'var(--ais-page-text)' }}>
                                        {t(`${key}_title`)}
                                    </h3>
                                    <p className="text-xs leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                                        {t(`${key}_desc`)}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
