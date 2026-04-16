'use client';

import { useTranslations } from 'next-intl';
import { Monitor, Database, ShieldCheck, BarChart3 } from 'lucide-react';

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    yellow:  { bg: 'bg-yellow-500/10',  text: 'text-yellow-400' },
    blue:    { bg: 'bg-blue-500/10',    text: 'text-blue-400' },
    purple:  { bg: 'bg-purple-500/10',  text: 'text-purple-400' },
};

const CAPABILITIES = [
    { icon: Monitor, key: 'cap_digital', color: 'emerald' },
    { icon: Database, key: 'cap_blockchain', color: 'yellow' },
    { icon: ShieldCheck, key: 'cap_compliance', color: 'blue' },
    { icon: BarChart3, key: 'cap_optimization', color: 'purple' },
];

export function PartnershipDeploymentSection() {
    const t = useTranslations('Partnership');

    return (
        <section className="py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                <div className="mb-12 max-w-3xl">
                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-yellow-400 mb-3">{t('deployment_badge')}</p>
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                        {t('deployment_title')}
                    </h2>
                    <p className="text-sm sm:text-base leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('deployment_desc')}
                    </p>
                </div>

                {/* Timeline / Steps */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {CAPABILITIES.map(({ icon: Icon, key, color }, i) => (
                        <div
                            key={key}
                            className="rounded-2xl p-8 hover:border-emerald-500/20 transition-all duration-300 flex gap-5"
                            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                        >
                            <div className="flex flex-col items-center gap-2 flex-shrink-0">
                                <div className={`w-12 h-12 rounded-xl ${COLOR_MAP[color].bg} flex items-center justify-center`}>
                                    <Icon className={`w-6 h-6 ${COLOR_MAP[color].text}`} />
                                </div>
                                <span className="text-[10px] font-bold text-emerald-500/50">{String(i + 1).padStart(2, '0')}</span>
                            </div>
                            <div>
                                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--ais-page-text)' }}>
                                    {t(`${key}_title`)}
                                </h3>
                                <p className="text-sm leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                                    {t(`${key}_desc`)}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
