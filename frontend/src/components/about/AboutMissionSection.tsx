'use client';

import { useTranslations } from 'next-intl';
import { Leaf, Shield, Database } from 'lucide-react';

const PILLARS = [
    { icon: Leaf, key: 'pillar_african', color: 'emerald' },
    { icon: Shield, key: 'pillar_sovereignty', color: 'yellow' },
    { icon: Database, key: 'pillar_expertise', color: 'blue' },
];

export function AboutMissionSection() {
    const t = useTranslations('About');

    return (
        <section className="py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                {/* Section header */}
                <div className="mb-12 max-w-3xl">
                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400 mb-3">{t('mission_badge')}</p>
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                        {t('mission_title')}
                    </h2>
                    <p className="text-sm sm:text-base leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('mission_desc')}
                    </p>
                </div>

                {/* 3 pillars */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {PILLARS.map(({ icon: Icon, key, color }) => (
                        <div
                            key={key}
                            className="rounded-2xl p-8 hover:border-emerald-500/20 transition-all duration-300"
                            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                        >
                            <div className={`w-12 h-12 rounded-xl bg-${color}-500/10 flex items-center justify-center mb-5`}>
                                <Icon className={`w-6 h-6 text-${color}-400`} />
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
            </div>
        </section>
    );
}
