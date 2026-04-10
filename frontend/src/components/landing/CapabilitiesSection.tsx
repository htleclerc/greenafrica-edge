'use client';

import { useTranslations } from 'next-intl';
import { Ship, Leaf, Radio } from 'lucide-react';

export function CapabilitiesSection() {
    const t = useTranslations('Landing');

    const capabilities = [
        {
            icon: Ship,
            title: t('cap_tax_title'),
            desc: t('cap_tax_desc'),
            gradient: 'from-emerald-500/20 to-emerald-900/10',
            iconBg: 'bg-emerald-500/10',
            iconColor: 'text-emerald-400',
        },
        {
            icon: Leaf,
            title: t('cap_credits_title'),
            desc: t('cap_credits_desc'),
            gradient: 'from-yellow-500/20 to-yellow-900/10',
            iconBg: 'bg-yellow-500/10',
            iconColor: 'text-yellow-400',
        },
        {
            icon: Radio,
            title: t('cap_ais_title'),
            desc: t('cap_ais_desc'),
            gradient: 'from-blue-500/20 to-blue-900/10',
            iconBg: 'bg-blue-500/10',
            iconColor: 'text-blue-400',
        },
    ];

    return (
        <section className="pt-16 pb-12 sm:py-20 px-3 sm:px-6 relative" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-10 sm:mb-12">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.15em] uppercase mb-4">
                        {t('capabilities_badge')}
                    </div>
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight" style={{ color: 'var(--ais-page-text)' }}>
                        {t('capabilities_title')}
                    </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-6">
                    {capabilities.map((cap, i) => (
                        <div
                            key={i}
                            className="relative rounded-2xl p-5 sm:p-8 hover:border-emerald-500/20 transition-all duration-300 group overflow-hidden"
                            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                        >
                            {/* Gradient hover effect */}
                            <div className={`absolute inset-0 bg-gradient-to-br ${cap.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                            <div className="relative z-10">
                                <div className={`w-12 h-12 rounded-xl ${cap.iconBg} flex items-center justify-center mb-6`}>
                                    <cap.icon className={`w-6 h-6 ${cap.iconColor}`} />
                                </div>

                                <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--ais-page-text)' }}>{cap.title}</h3>
                                <p className="text-sm leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>{cap.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
