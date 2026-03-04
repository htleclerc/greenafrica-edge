'use client';

import { useTranslations } from 'next-intl';
import { Building2, ExternalLink, Mail } from 'lucide-react';
import { fundingPartners } from '@/mock/datas/projectsMock';

const TYPE_COLOR: Record<string, { bg: string; text: string; border: string }> = {
    Multilateral: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
    'UN Agency': { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30' },
    'Regional Bank': { bg: 'bg-teal-500/15', text: 'text-teal-400', border: 'border-teal-500/30' },
    Bilateral: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30' },
    'Regional Body': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    'Standard Body': { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30' },
};

function formatCommitment(usd: number): string {
    if (usd === 0) return 'Technical Support';
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
    return `$${usd.toLocaleString()}`;
}

export function ProjectsPartnersSection() {
    const t = useTranslations('Projects');

    return (
        <section className="py-16 px-6 bg-[#0A1110]">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        {t('partners_badge')}
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-3">{t('partners_title')}</h2>
                    <p className="text-slate-400 text-sm max-w-2xl">{t('partners_subtitle')}</p>
                </div>

                {/* Partners grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
                    {fundingPartners.map((partner) => {
                        const typeColor = TYPE_COLOR[partner.type] ?? {
                            bg: 'bg-slate-500/15',
                            text: 'text-slate-400',
                            border: 'border-slate-500/30',
                        };

                        return (
                            <div
                                key={partner.id}
                                className="bg-[#111C18] rounded-2xl border border-white/5 hover:border-emerald-500/15 transition-all duration-300 p-5 flex flex-col gap-3"
                            >
                                {/* Acronym badge */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                        <Building2 className="w-5 h-5 text-emerald-400" />
                                    </div>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeColor.bg} ${typeColor.text} ${typeColor.border}`}>
                                        {partner.type}
                                    </span>
                                </div>

                                <div>
                                    <p className="text-sm font-bold text-white">{partner.acronym}</p>
                                    <p className="text-[11px] text-slate-500 mt-0.5">{partner.name}</p>
                                </div>

                                <p className="text-[11px] text-slate-500 leading-relaxed flex-1">
                                    {partner.description}
                                </p>

                                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-bold text-emerald-400">
                                            {formatCommitment(partner.totalCommitmentUsd)}
                                        </p>
                                        <p className="text-[9px] text-slate-600 uppercase tracking-wide">
                                            {t('partner_commitment')}
                                        </p>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-slate-600 hover:text-slate-300 cursor-pointer transition-colors" />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* CTA Banner */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-900/40 via-teal-900/20 to-[#111C18] border border-emerald-500/15 p-8 md:p-10">
                    <div className="absolute -right-20 -top-20 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
                    <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                        <div>
                            <h3 className="text-xl font-bold text-white mb-2">{t('partners_cta_title')}</h3>
                            <p className="text-sm text-slate-400 max-w-xl">{t('partners_cta_subtitle')}</p>
                        </div>
                        <button className="shrink-0 flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.35)]">
                            <Mail className="w-4 h-4" />
                            {t('partners_cta_btn')}
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
