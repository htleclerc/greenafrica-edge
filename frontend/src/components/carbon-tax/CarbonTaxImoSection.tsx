'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Scale, ArrowRight, Globe, ShieldCheck, FileText } from 'lucide-react';

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    yellow:  { bg: 'bg-yellow-500/10',  text: 'text-yellow-400' },
    blue:    { bg: 'bg-blue-500/10',    text: 'text-blue-400' },
};

const PILLARS = [
    { icon: Scale, key: 'imo_pricing', color: 'emerald' },
    { icon: Globe, key: 'imo_gfi', color: 'yellow' },
    { icon: ShieldCheck, key: 'imo_compliance', color: 'blue' },
];

export function CarbonTaxImoSection() {
    const t = useTranslations('CarbonTax');

    return (
        <section className="py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                <div className="mb-10 max-w-3xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        <FileText className="w-3 h-3" />
                        {t('imo_badge')}
                    </div>
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                        {t('imo_title')}
                    </h2>
                    <p className="text-sm sm:text-base leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('imo_desc')}
                    </p>
                </div>

                {/* Key facts banner */}
                <div
                    className="rounded-2xl p-6 sm:p-8 mb-8 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center"
                    style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                >
                    <div>
                        <p className="text-2xl font-black text-yellow-400">$100–$380</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--ais-page-text-muted)' }}>{t('imo_fact_price')}</p>
                    </div>
                    <div>
                        <p className="text-2xl font-black text-emerald-400">April 2025</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--ais-page-text-muted)' }}>{t('imo_fact_date')}</p>
                    </div>
                    <div>
                        <p className="text-2xl font-black text-blue-400">63</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--ais-page-text-muted)' }}>{t('imo_fact_countries')}</p>
                    </div>
                </div>

                {/* 3 pillars */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    {PILLARS.map(({ icon: Icon, key, color }) => (
                        <div
                            key={key}
                            className="rounded-2xl p-8 hover:border-emerald-500/20 transition-all duration-300"
                            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                        >
                            <div className={`w-12 h-12 rounded-xl ${COLOR_MAP[color].bg} flex items-center justify-center mb-5`}>
                                <Icon className={`w-6 h-6 ${COLOR_MAP[color].text}`} />
                            </div>
                            <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--ais-page-text)' }}>
                                {t(`${key}_title`)}
                            </h3>
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                                {t(`${key}_desc`)}
                            </p>
                        </div>
                    ))}
                </div>

                {/* CTA to ASCR */}
                <div className="text-center">
                    <Link
                        href="/ascr"
                        className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm font-semibold transition-colors"
                    >
                        {t('imo_cta_ascr')}
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        </section>
    );
}
