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
        <section className="py-16 px-6 relative" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-emerald-900/8 rounded-full blur-[150px]" />

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-bold tracking-[0.15em] uppercase mb-5">
                        <ShieldCheck className="w-3 h-3" />
                        {t('compliance_badge')}
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold mb-3" style={{ color: 'var(--ais-page-text)' }}>{t('compliance_title')}</h2>
                    <p className="text-base max-w-2xl mx-auto" style={{ color: 'var(--ais-page-text-muted)' }}>{t('compliance_subtitle')}</p>
                </div>

                {/* Regulation cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
                    {complianceRegulations.map((reg) => {
                        const style = REGULATION_STYLES[reg.code];
                        return (
                            <div
                                key={reg.id}
                                className="rounded-2xl p-6 transition-all duration-300"
                                style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
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
                                            className="transition-colors"
                                            style={{ color: 'var(--ais-page-text-dim)' }}
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                    )}
                                </div>

                                <h3 className={`text-base font-bold mb-2 ${style.accent}`}>{reg.name}</h3>
                                <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--ais-page-text-muted)' }}>{reg.description}</p>

                                {/* Key requirement */}
                                <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: 'var(--ais-page-bg)', border: '1px solid var(--ais-page-border)' }}>
                                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>
                                        {t('key_requirement')}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--ais-page-text-secondary)' }}>{reg.keyRequirement}</p>
                                </div>

                                {/* Penalty note */}
                                <div className="flex items-start gap-2">
                                    <AlertTriangle className="w-3.5 h-3.5 text-red-500/70 shrink-0 mt-0.5" />
                                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ais-page-text-dim)' }}>{reg.penaltyNote}</p>
                                </div>

                                {/* Effective date */}
                                <div className="flex justify-end mt-3">
                                    <span className="text-[10px]" style={{ color: 'var(--ais-page-text-dim)' }}>
                                        {t('effective_since')} {reg.effectiveDate}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Disclaimer */}
                <div className="flex items-start gap-3 text-[11px] max-w-4xl mx-auto rounded-xl p-4" style={{ color: 'var(--ais-page-text-dim)', backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                    <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--ais-page-text-dim)' }} />
                    <p className="leading-relaxed">{t('compliance_disclaimer')}</p>
                </div>
            </div>
        </section>
    );
}
