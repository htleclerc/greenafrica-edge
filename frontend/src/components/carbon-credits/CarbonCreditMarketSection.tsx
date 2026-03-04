'use client';

import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { marketRates } from '@/mock/datas/carbonCreditMock';
import {
    CreditStandardLabel,
    CreditStandardColor,
    CreditGradeColor,
} from '@/domain/carbonCredit/carbonCreditConstants';

function TrendIcon({ trend, pct }: { trend: string; pct: number }) {
    if (trend === 'UP') return (
        <span className="flex items-center gap-1 text-emerald-400 text-[11px] font-semibold">
            <TrendingUp className="w-3.5 h-3.5" />+{pct}%
        </span>
    );
    if (trend === 'DOWN') return (
        <span className="flex items-center gap-1 text-red-400 text-[11px] font-semibold">
            <TrendingDown className="w-3.5 h-3.5" />{pct}%
        </span>
    );
    return (
        <span className="flex items-center gap-1 text-slate-400 text-[11px] font-semibold">
            <Minus className="w-3.5 h-3.5" />{pct}%
        </span>
    );
}

export function CarbonCreditMarketSection() {
    const t = useTranslations('CarbonCredit');

    return (
        <section className="py-16 px-6 bg-[#0D1714]">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        {t('market_badge')}
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-3">{t('market_title')}</h2>
                    <p className="text-slate-400 text-sm max-w-2xl">{t('market_subtitle')}</p>
                </div>

                {/* Rates Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {marketRates.map((rate) => {
                        const stdColor = CreditStandardColor[rate.standard];
                        const gradeColor = CreditGradeColor[rate.grade];
                        return (
                            <div
                                key={rate.id}
                                className="bg-[#111C18] rounded-2xl p-5 border border-white/5 hover:border-teal-500/20 transition-all duration-300 flex flex-col gap-4"
                            >
                                {/* Top row */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex flex-col gap-2">
                                        <span
                                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${stdColor.bg} ${stdColor.text} ${stdColor.border}`}
                                        >
                                            {CreditStandardLabel[rate.standard]}
                                        </span>
                                        <h3 className="text-sm font-semibold text-white leading-snug">
                                            {rate.name}
                                        </h3>
                                    </div>
                                    <span className={`text-lg font-bold ${gradeColor} shrink-0`}>
                                        {rate.grade}
                                    </span>
                                </div>

                                {/* Price */}
                                <div className="flex items-end justify-between">
                                    <div>
                                        <p className="text-2xl font-bold text-white">
                                            ${rate.pricePerTon.toFixed(1)}
                                            <span className="text-xs text-slate-500 font-normal ml-1">/tCO₂</span>
                                        </p>
                                        <p className="text-[10px] text-slate-600 mt-0.5">
                                            ${rate.priceMin}–${rate.priceMax}/tCO₂ range
                                        </p>
                                    </div>
                                    <TrendIcon trend={rate.trend} pct={rate.trendPct} />
                                </div>

                                {/* Description */}
                                <p className="text-xs text-slate-500 leading-relaxed border-t border-white/5 pt-3">
                                    {rate.description}
                                </p>

                                {/* Certifier */}
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-600">{t('certifier')}</span>
                                    <span className="text-[10px] font-semibold text-slate-400">{rate.certifier}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Disclaimer */}
                <p className="mt-6 text-[11px] text-slate-600 text-center max-w-3xl mx-auto">
                    {t('market_disclaimer')}
                </p>
            </div>
        </section>
    );
}
