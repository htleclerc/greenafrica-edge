'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { creditFrameworks } from '@/mock/datas/carbonCreditMock';
import { CreditStandardLabel, CreditStandardColor } from '@/domain/carbonCredit/carbonCreditConstants';

export function CarbonCreditFrameworkSection() {
    const t = useTranslations('CarbonCredit');

    return (
        <section className="py-16 px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        {t('framework_badge')}
                    </div>
                    <h2 className="text-3xl font-bold mb-3" style={{ color: 'var(--ais-page-text)' }}>{t('framework_title')}</h2>
                    <p className="text-sm max-w-2xl" style={{ color: 'var(--ais-page-text-muted)' }}>{t('framework_subtitle')}</p>
                </div>

                {/* Framework cards */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {creditFrameworks.map((fw) => {
                        const stdColor = CreditStandardColor[fw.code];
                        return (
                            <div
                                key={fw.id}
                                className="rounded-2xl p-6 hover:border-purple-500/20 transition-all duration-300 flex flex-col gap-4"
                                style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                            >
                                {/* Top Row */}
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex flex-col gap-2">
                                        <span
                                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border w-fit ${stdColor.bg} ${stdColor.text} ${stdColor.border}`}
                                        >
                                            {CreditStandardLabel[fw.code]}
                                        </span>
                                        <h3 className="text-base font-bold leading-snug" style={{ color: 'var(--ais-page-text)' }}>{fw.name}</h3>
                                        <p className="text-[11px]" style={{ color: 'var(--ais-page-text-dim)' }}>{fw.authority}</p>
                                    </div>
                                    <a
                                        href={fw.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="shrink-0 hover:text-teal-400 transition-colors"
                                        style={{ color: 'var(--ais-page-text-dim)' }}
                                        aria-label={`Open ${fw.name} website`}
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                </div>

                                {/* Description */}
                                <p className="text-xs leading-relaxed pt-4" style={{ color: 'var(--ais-page-text-muted)', borderTop: '1px solid var(--ais-page-border)' }}>
                                    {fw.description}
                                </p>

                                {/* Key Requirement */}
                                <div className="bg-white/3 rounded-xl p-3" style={{ border: '1px solid var(--ais-page-border)' }}>
                                    <p className="text-[10px] font-bold text-teal-400 uppercase tracking-wider mb-1.5">
                                        {t('key_requirement')}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--ais-page-text-secondary)' }}>{fw.keyRequirement}</p>
                                </div>

                                {/* Note */}
                                <div className="flex items-start gap-2">
                                    <span className="text-[10px] shrink-0 mt-0.5" style={{ color: 'var(--ais-page-text-dim)' }}>ℹ</span>
                                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ais-page-text-dim)' }}>{fw.noteText}</p>
                                </div>

                                {/* Effective Date */}
                                <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--ais-page-border)' }}>
                                    <span className="text-[10px]" style={{ color: 'var(--ais-page-text-dim)' }}>{t('effective_since')}</span>
                                    <span className="text-[10px] font-semibold" style={{ color: 'var(--ais-page-text-muted)' }}>{fw.effectiveDate}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Disclaimer */}
                <p className="mt-8 text-[11px] text-center max-w-3xl mx-auto leading-relaxed" style={{ color: 'var(--ais-page-text-dim)' }}>
                    {t('framework_disclaimer')}
                </p>
            </div>
        </section>
    );
}
