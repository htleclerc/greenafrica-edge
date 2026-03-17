'use client';

import { useTranslations } from 'next-intl';
import { ShieldCheck, Zap, BarChart3, Globe } from 'lucide-react';

export function ImpactSection() {
    const t = useTranslations('Landing');
    const c = useTranslations('Common');

    const stats = [
        { label: 'Hectares Protected', value: '2.4M', badge: '+12%', icon: ShieldCheck, color: 'text-emerald-400', badgeColor: 'bg-emerald-500/20 text-emerald-400' },
        { label: 'Tons CO2 Reduced', value: '450k', badge: '-8.5%', icon: Zap, color: 'text-blue-400', badgeColor: 'bg-blue-500/20 text-blue-400' },
        { label: 'Green Revenue Generated', value: '$85M', badge: '+$15M', icon: BarChart3, color: 'text-amber-400', badgeColor: 'bg-amber-500/20 text-amber-400' },
        { label: 'State Partners', value: '14', badge: 'New', icon: Globe, color: 'text-purple-400', badgeColor: 'bg-purple-500/20 text-purple-400' },
    ];

    return (
        <section className="py-24 px-6 relative" style={{ backgroundColor: 'var(--ais-page-bg-alt)' }}>
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
                    <div className="max-w-2xl">
                        <h2 className="text-4xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>{t('impact_title')}</h2>
                        <p className="text-lg" style={{ color: 'var(--ais-page-text-muted)' }}>{t('impact_subtitle')}</p>
                    </div>
                    <button className="px-6 py-2.5 rounded-full border transition-colors text-sm font-semibold shrink-0" style={{ borderColor: 'var(--ais-page-border)', color: 'var(--ais-page-text-secondary)' }}>
                        {c('view_full_report')}
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {stats.map((stat, i) => (
                        <div key={i} className="rounded-2xl p-6 hover:brightness-110 transition-colors relative overflow-hidden group" style={{ backgroundColor: 'var(--ais-page-surface)', border: '1px solid var(--ais-page-border)' }}>
                            <div className="flex justify-between items-start mb-12">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.color}`} style={{ backgroundColor: 'var(--ais-page-card)' }}>
                                    <stat.icon className="w-5 h-5" />
                                </div>
                                <span className={`text-xs font-bold px-2 py-1 rounded ${stat.badgeColor}`}>
                                    {stat.badge}
                                </span>
                            </div>

                            <div>
                                <h3 className="text-4xl font-bold mb-2" style={{ color: 'var(--ais-page-text)' }}>{stat.value}</h3>
                                <p className="text-sm font-medium" style={{ color: 'var(--ais-page-text-muted)' }}>{stat.label}</p>
                            </div>

                            {/* Decorative progress line like mockup */}
                            <div className="absolute bottom-6 left-6 right-6 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--ais-page-card)' }}>
                                <div className="h-full bg-emerald-500 w-2/3 group-hover:w-full transition-all duration-1000" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
