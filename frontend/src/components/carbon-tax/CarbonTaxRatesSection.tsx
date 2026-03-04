'use client';

import { useTranslations } from 'next-intl';
import { Scale, CheckCircle2, Clock } from 'lucide-react';
import { carbonTaxRates } from '@/mock/datas/carbonTaxMock';
import { TaxRegulation } from '@/domain/carbonTax/carbonTaxConstants';

const REGULATION_COLORS: Record<TaxRegulation, { dot: string; badge: string; badgeText: string }> = {
    [TaxRegulation.AFRICGREEN_SOVEREIGN]: {
        dot: 'bg-emerald-500',
        badge: 'bg-emerald-500/15 border-emerald-500/30',
        badgeText: 'text-emerald-400',
    },
    [TaxRegulation.IMO_CII]: {
        dot: 'bg-blue-500',
        badge: 'bg-blue-500/15 border-blue-500/30',
        badgeText: 'text-blue-400',
    },
    [TaxRegulation.EU_ETS]: {
        dot: 'bg-yellow-500',
        badge: 'bg-yellow-500/15 border-yellow-500/30',
        badgeText: 'text-yellow-400',
    },
    [TaxRegulation.CORSIA]: {
        dot: 'bg-purple-500',
        badge: 'bg-purple-500/15 border-purple-500/30',
        badgeText: 'text-purple-400',
    },
    [TaxRegulation.IMO_MARPOL]: {
        dot: 'bg-orange-500',
        badge: 'bg-orange-500/15 border-orange-500/30',
        badgeText: 'text-orange-400',
    },
};

export function CarbonTaxRatesSection() {
    const t = useTranslations('CarbonTax');

    return (
        <section className="py-16 px-6 bg-[#0D1512] relative">
            <div className="absolute top-0 left-0 w-[500px] h-[400px] bg-blue-900/10 rounded-full blur-[150px] -translate-x-1/2" />

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Section header */}
                <div className="mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold tracking-[0.15em] uppercase mb-5">
                        <Scale className="w-3 h-3" />
                        {t('rates_badge')}
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">{t('rates_title')}</h2>
                    <p className="text-slate-400 text-base max-w-2xl">{t('rates_subtitle')}</p>
                </div>

                {/* Rate cards grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {carbonTaxRates.map((rate) => {
                        const colors = REGULATION_COLORS[rate.regulation];
                        return (
                            <div
                                key={rate.id}
                                className="bg-[#111C18] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4"
                            >
                                {/* Header */}
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2.5 h-2.5 rounded-full ${colors.dot} shrink-0 mt-0.5`} />
                                        <h3 className="text-sm font-bold text-white leading-snug">{rate.name}</h3>
                                    </div>
                                    <span
                                        className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${colors.badge} ${colors.badgeText}`}
                                    >
                                        {rate.mandatory ? t('mandatory') : t('voluntary')}
                                    </span>
                                </div>

                                {/* Rate value */}
                                <div className="bg-[#0A1110]/60 rounded-xl p-4 border border-white/5">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                        {t('rate_per_ton')}
                                    </p>
                                    <p className="text-3xl font-bold text-white">
                                        ${rate.ratePerTon}
                                        <span className="text-sm text-slate-400 font-normal ml-1">/tCO₂</span>
                                    </p>
                                </div>

                                {/* Details */}
                                <div className="space-y-2 text-[11px] text-slate-400 flex-1">
                                    <div className="flex items-start gap-2">
                                        <CheckCircle2 className="w-3 h-3 text-slate-600 shrink-0 mt-0.5" />
                                        <span>{rate.applicability}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-3 h-3 text-slate-600 shrink-0" />
                                        <span>{t('effective_since')} {rate.effectiveDate}</span>
                                    </div>
                                </div>

                                {/* Authority */}
                                <div className="pt-3 border-t border-white/5">
                                    <p className="text-[10px] text-slate-600 font-medium">{rate.authority}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
