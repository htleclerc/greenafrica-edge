'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { creditFrameworks } from '@/mock/datas/carbonCreditMock';
import { CreditStandardLabel, CreditStandardColor } from '@/domain/carbonCredit/carbonCreditConstants';

export function CarbonCreditFrameworkSection() {
    const t = useTranslations('CarbonCredit');

    return (
        <section className="py-16 px-6 bg-[#0A1110]">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        {t('framework_badge')}
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-3">{t('framework_title')}</h2>
                    <p className="text-slate-400 text-sm max-w-2xl">{t('framework_subtitle')}</p>
                </div>

                {/* Framework cards */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {creditFrameworks.map((fw) => {
                        const stdColor = CreditStandardColor[fw.code];
                        return (
                            <div
                                key={fw.id}
                                className="bg-[#111C18] rounded-2xl p-6 border border-white/5 hover:border-purple-500/20 transition-all duration-300 flex flex-col gap-4"
                            >
                                {/* Top Row */}
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex flex-col gap-2">
                                        <span
                                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border w-fit ${stdColor.bg} ${stdColor.text} ${stdColor.border}`}
                                        >
                                            {CreditStandardLabel[fw.code]}
                                        </span>
                                        <h3 className="text-base font-bold text-white leading-snug">{fw.name}</h3>
                                        <p className="text-[11px] text-slate-500">{fw.authority}</p>
                                    </div>
                                    <a
                                        href={fw.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="shrink-0 text-slate-500 hover:text-teal-400 transition-colors"
                                        aria-label={`Open ${fw.name} website`}
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                </div>

                                {/* Description */}
                                <p className="text-xs text-slate-400 leading-relaxed border-t border-white/5 pt-4">
                                    {fw.description}
                                </p>

                                {/* Key Requirement */}
                                <div className="bg-white/3 rounded-xl p-3 border border-white/5">
                                    <p className="text-[10px] font-bold text-teal-400 uppercase tracking-wider mb-1.5">
                                        {t('key_requirement')}
                                    </p>
                                    <p className="text-xs text-slate-300">{fw.keyRequirement}</p>
                                </div>

                                {/* Note */}
                                <div className="flex items-start gap-2">
                                    <span className="text-[10px] text-slate-600 shrink-0 mt-0.5">ℹ</span>
                                    <p className="text-[11px] text-slate-600 leading-relaxed">{fw.noteText}</p>
                                </div>

                                {/* Effective Date */}
                                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                    <span className="text-[10px] text-slate-600">{t('effective_since')}</span>
                                    <span className="text-[10px] font-semibold text-slate-400">{fw.effectiveDate}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Disclaimer */}
                <p className="mt-8 text-[11px] text-slate-600 text-center max-w-3xl mx-auto leading-relaxed">
                    {t('framework_disclaimer')}
                </p>
            </div>
        </section>
    );
}
