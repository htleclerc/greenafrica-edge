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
        <section className="py-20 px-6 bg-[#0A1110] relative">
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {capabilities.map((cap, i) => (
                        <div
                            key={i}
                            className="relative bg-[#111C18] rounded-2xl p-8 border border-white/5 hover:border-emerald-500/20 transition-all duration-300 group overflow-hidden"
                        >
                            {/* Gradient hover effect */}
                            <div className={`absolute inset-0 bg-gradient-to-br ${cap.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                            <div className="relative z-10">
                                <div className={`w-12 h-12 rounded-xl ${cap.iconBg} flex items-center justify-center mb-6`}>
                                    <cap.icon className={`w-6 h-6 ${cap.iconColor}`} />
                                </div>

                                <h3 className="text-lg font-bold text-white mb-3">{cap.title}</h3>
                                <p className="text-sm text-slate-400 leading-relaxed">{cap.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
