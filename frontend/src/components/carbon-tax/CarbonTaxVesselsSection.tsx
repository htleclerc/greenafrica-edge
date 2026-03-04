'use client';

import { useTranslations } from 'next-intl';
import { Ship, Anchor } from 'lucide-react';
import { taxVessels } from '@/mock/datas/carbonTaxMock';
import {
    VesselTaxStatus,
    VesselTaxStatusLabel,
    VesselTaxStatusColor,
    VesselTypeLabel,
    CiiRatingColor,
} from '@/domain/carbonTax/carbonTaxConstants';

function formatCurrency(amount: number): string {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
    return `$${amount}`;
}

function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}

export function CarbonTaxVesselsSection() {
    const t = useTranslations('CarbonTax');

    const statusCounts = {
        [VesselTaxStatus.PAID]: taxVessels.filter((v) => v.status === VesselTaxStatus.PAID).length,
        [VesselTaxStatus.PENDING]: taxVessels.filter((v) => v.status === VesselTaxStatus.PENDING).length,
        [VesselTaxStatus.OVERDUE]: taxVessels.filter((v) => v.status === VesselTaxStatus.OVERDUE).length,
        [VesselTaxStatus.APPROACHING]: taxVessels.filter((v) => v.status === VesselTaxStatus.APPROACHING).length,
    };

    return (
        <section className="py-16 px-6 bg-[#0A1110] relative">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
                    <div>
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[10px] font-bold tracking-[0.15em] uppercase mb-5">
                            <Anchor className="w-3 h-3" />
                            {t('vessels_badge')}
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">{t('vessels_title')}</h2>
                        <p className="text-slate-400 text-sm">{t('vessels_subtitle')}</p>
                    </div>

                    {/* Status summary pills */}
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(statusCounts).map(([status, count]) => {
                            const s = status as VesselTaxStatus;
                            const colors = VesselTaxStatusColor[s];
                            return (
                                <div
                                    key={s}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${colors.bg} ${colors.text} ${colors.border}`}
                                >
                                    <span className="font-bold">{count}</span>
                                    <span>{VesselTaxStatusLabel[s]}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Desktop Table */}
                <div className="bg-[#111C18] rounded-2xl border border-white/5 overflow-hidden hidden md:block">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/5 text-[10px] text-slate-500 uppercase tracking-wider">
                                    <th className="text-left px-6 py-4 font-semibold">{t('col_vessel')}</th>
                                    <th className="text-left px-4 py-4 font-semibold">{t('col_type')}</th>
                                    <th className="text-right px-4 py-4 font-semibold">{t('col_gt')}</th>
                                    <th className="text-right px-4 py-4 font-semibold">{t('col_co2')}</th>
                                    <th className="text-right px-4 py-4 font-semibold">{t('col_tax')}</th>
                                    <th className="text-center px-4 py-4 font-semibold">{t('col_cii')}</th>
                                    <th className="text-center px-6 py-4 font-semibold">{t('col_status')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {taxVessels.map((vessel, i) => {
                                    const colors = VesselTaxStatusColor[vessel.status];
                                    const ciiColor = CiiRatingColor[vessel.ciiRating];
                                    return (
                                        <tr
                                            key={vessel.id}
                                            className={`border-b border-white/5 hover:bg-white/2 transition-colors ${i === taxVessels.length - 1 ? 'border-b-0' : ''
                                                }`}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-slate-800/60 flex items-center justify-center shrink-0">
                                                        <Ship className="w-4 h-4 text-slate-400" />
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-white text-sm leading-snug">
                                                            {vessel.name}
                                                        </p>
                                                        <p className="text-[10px] text-slate-500">
                                                            {vessel.flagEmoji} {vessel.flag} · {vessel.imo}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-slate-400 text-xs">
                                                {VesselTypeLabel[vessel.type]}
                                            </td>
                                            <td className="px-4 py-4 text-right text-slate-300 text-xs font-mono">
                                                {formatNumber(vessel.grossTonnage)}
                                            </td>
                                            <td className="px-4 py-4 text-right text-slate-300 text-xs font-mono">
                                                {formatNumber(vessel.co2Estimated)} t
                                            </td>
                                            <td className="px-4 py-4 text-right font-bold text-white text-sm">
                                                {formatCurrency(vessel.taxAmount)}
                                            </td>
                                            <td className="px-4 py-4 text-center">
                                                <span className={`text-lg font-black ${ciiColor}`}>
                                                    {vessel.ciiRating}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span
                                                    className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[10px] font-bold tracking-wide ${colors.bg} ${colors.text} ${colors.border}`}
                                                >
                                                    {VesselTaxStatusLabel[vessel.status]}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden space-y-3">
                    {taxVessels.map((vessel) => {
                        const colors = VesselTaxStatusColor[vessel.status];
                        const ciiColor = CiiRatingColor[vessel.ciiRating];
                        return (
                            <div
                                key={vessel.id}
                                className="bg-[#111C18] rounded-2xl p-4 border border-white/5"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div>
                                        <p className="font-bold text-white text-sm">{vessel.name}</p>
                                        <p className="text-[10px] text-slate-500">
                                            {vessel.flagEmoji} {vessel.flag} · {VesselTypeLabel[vessel.type]}
                                        </p>
                                    </div>
                                    <span
                                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}
                                    >
                                        {VesselTaxStatusLabel[vessel.status]}
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-3 text-center">
                                    <div className="bg-[#0A1110]/60 rounded-lg p-2">
                                        <p className="text-[9px] text-slate-500 mb-0.5">{t('col_co2')}</p>
                                        <p className="text-xs font-bold text-white">{formatNumber(vessel.co2Estimated)} t</p>
                                    </div>
                                    <div className="bg-[#0A1110]/60 rounded-lg p-2">
                                        <p className="text-[9px] text-slate-500 mb-0.5">{t('col_tax')}</p>
                                        <p className="text-xs font-bold text-white">{formatCurrency(vessel.taxAmount)}</p>
                                    </div>
                                    <div className="bg-[#0A1110]/60 rounded-lg p-2">
                                        <p className="text-[9px] text-slate-500 mb-0.5">{t('col_cii')}</p>
                                        <p className={`text-sm font-black ${ciiColor}`}>{vessel.ciiRating}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
