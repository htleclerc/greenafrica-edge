'use client';

import { useTranslations } from 'next-intl';
import { FileText, BarChart3, ShieldCheck, Activity } from 'lucide-react';

export function ReportsHeroSection() {
    const t = useTranslations('Reports');

    const stats = [
        { labelCode: 'total_generated', value: '128', icon: FileText, color: 'text-emerald-400' },
        { labelCode: 'analytic_insights', value: '42', icon: BarChart3, color: 'text-blue-400' },
        { labelCode: 'compliant_reports', value: '100%', icon: ShieldCheck, color: 'text-amber-400' },
        { labelCode: 'system_up_time', value: '99.9%', icon: Activity, color: 'text-purple-400' },
    ];

    return (
        <section className="relative pt-24 sm:pt-28 md:pt-32 pb-12 sm:pb-16 md:pb-24 px-3 sm:px-4 md:px-6 overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            {/* Background elements */}
            <div className="absolute top-0 right-0 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] bg-emerald-500/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/4" />
            <div className="absolute bottom-0 left-0 w-[300px] sm:w-[400px] h-[300px] sm:h-[400px] bg-blue-500/5 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/4" />

            <div className="max-w-7xl mx-auto relative z-10">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-8">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    {t('hero_badge')}
                </div>

                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-6 tracking-tight" style={{ color: 'var(--ais-page-text)' }}>
                    {t('hero_title_line1')} <br />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-emerald-200 to-blue-400">
                        {t('hero_title_line2')}
                    </span>
                </h1>

                <p className="max-w-2xl text-sm sm:text-base md:text-lg lg:text-xl leading-relaxed mb-8 sm:mb-12" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('hero_subtitle')}
                </p>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 md:gap-6">
                    {stats.map((stat, idx) => (
                        <div
                            key={idx}
                            className="backdrop-blur-md rounded-2xl p-6 transition-all duration-300 group"
                            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                        >
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform ${stat.color}`} style={{ backgroundColor: 'var(--ais-page-surface)' }}>
                                <stat.icon className="w-5 h-5" />
                            </div>
                            <div className="text-lg sm:text-2xl md:text-3xl font-bold mb-1" style={{ color: 'var(--ais-page-text)' }}>{stat.value}</div>
                            <div className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--ais-page-text-dim)' }}>{t(stat.labelCode)}</div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
