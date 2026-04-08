'use client';

import { useTranslations } from 'next-intl';
import { User } from 'lucide-react';

const FOUNDERS = [
    { key: 'kpatchavi', color: 'emerald' },
    { key: 'radji', color: 'yellow' },
    { key: 'dia', color: 'blue' },
];

export function AboutFoundersSection() {
    const t = useTranslations('About');

    return (
        <section className="py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                {/* Section header */}
                <div className="text-center mb-14 max-w-2xl mx-auto">
                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400 mb-3">{t('founders_badge')}</p>
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                        {t('founders_title')}
                    </h2>
                    <p className="text-sm sm:text-base leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('founders_desc')}
                    </p>
                </div>

                {/* Founder cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {FOUNDERS.map(({ key, color }) => (
                        <div
                            key={key}
                            className="rounded-2xl p-8 text-center hover:border-emerald-500/20 transition-all duration-300 group"
                            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                        >
                            {/* Avatar placeholder */}
                            <div className={`w-20 h-20 rounded-full bg-${color}-500/10 border-2 border-${color}-500/20 flex items-center justify-center mx-auto mb-6 group-hover:border-${color}-500/40 transition-colors`}>
                                <User className={`w-8 h-8 text-${color}-400`} />
                            </div>

                            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--ais-page-text)' }}>
                                {t(`founder_${key}_name`)}
                            </h3>
                            <p className={`text-xs font-semibold text-${color}-400 uppercase tracking-wider mb-4`}>
                                {t(`founder_${key}_role`)}
                            </p>
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                                {t(`founder_${key}_bio`)}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
