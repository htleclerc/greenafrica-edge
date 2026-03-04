'use client';

import { useTranslations } from 'next-intl';
import { ShieldCheck, ExternalLink, AlertTriangle } from 'lucide-react';
import { complianceRegulations } from '@/mock/datas/carbonTaxMock';
import { TaxRegulation } from '@/domain/carbonTax/carbonTaxConstants';

const REGULATION_STYLES: Record<TaxRegulation, { accent: string; bg: string; border: string }> = {
    [TaxRegulation.AFRICGREEN_SOVEREIGN]: {
        accent: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/20',
    },
    [TaxRegulation.IMO_CII]: {
        accent: 'text-blue-400',
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/20',
    },
    [TaxRegulation.EU_ETS]: {
        accent: 'text-yellow-400',
        bg: 'bg-yellow-500/10',
        border: 'border-yellow-500/20',
    },
    [TaxRegulation.CORSIA]: {
        accent: 'text-purple-400',
        bg: 'bg-purple-500/10',
        border: 'border-purple-500/20',
    },
    [TaxRegulation.IMO_MARPOL]: {
        accent: 'text-orange-400',
        bg: 'bg-orange-500/10',
        border: 'border-orange-500/20',
    },
};

export function CarbonTaxComplianceSection() {
    const t = useTranslations('CarbonTax');

    return (
        <section className="py-16 px-6 bg-[#0A1110] relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-emerald-900/8 rounded-full blur-[150px]" />

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-bold tracking-[0.15em] uppercase mb-5">
                        <ShieldCheck className="w-3 h-3" />
                        {t('compliance_badge')}
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">{t('compliance_title')}</h2>
                    <p className="text-slate-400 text-base max-w-2xl mx-auto">{t('compliance_subtitle')}</p>
                </div>

                {/* Regulation cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
                    {complianceRegulations.map((reg) => {
                        const style = REGULATION_STYLES[reg.code];
                        return (
                            <div
                                key={reg.id}
                                className="bg-[#111C18] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-all duration-300"
                            >
                                {/* Card header */}
                                <div className="flex items-start justify-between gap-3 mb-4">
                                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold ${style.bg} ${style.border} ${style.accent}`}>
                                        {reg.authority}
                                    </div>
                                    {reg.link !== '#' && (
                                        <a
                                            href={reg.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-slate-600 hover:text-slate-400 transition-colors"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                    )}
                                </div>

                                <h3 className={`text-base font-bold mb-2 ${style.accent}`}>{reg.name}</h3>
                                <p className="text-sm text-slate-400 leading-relaxed mb-4">{reg.description}</p>

                                {/* Key requirement */}
                                <div className="bg-[#0A1110]/60 rounded-xl p-3 border border-white/5 mb-3">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                        {t('key_requirement')}
                                    </p>
                                    <p className="text-xs text-slate-300">{reg.keyRequirement}</p>
                                </div>

                                {/* Penalty note */}
                                <div className="flex items-start gap-2">
                                    <AlertTriangle className="w-3.5 h-3.5 text-red-500/70 shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-slate-500 leading-relaxed">{reg.penaltyNote}</p>
                                </div>

                                {/* Effective date */}
                                <div className="flex justify-end mt-3">
                                    <span className="text-[10px] text-slate-600">
                                        {t('effective_since')} {reg.effectiveDate}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Disclaimer */}
                <div className="flex items-start gap-3 text-[11px] text-slate-600 max-w-4xl mx-auto bg-[#111C18] rounded-xl p-4 border border-white/5">
                    <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-slate-700" />
                    <p className="leading-relaxed">{t('compliance_disclaimer')}</p>
                </div>
            </div>
        </section>
    );
}
