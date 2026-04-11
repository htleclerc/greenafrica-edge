'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Calculator, DollarSign, Ship, Wind } from 'lucide-react';

const DEFAULT_TAX_RATE = 17; // Djibouti benchmark $/tCO2
const DEFAULT_AVG_CO2 = 85; // avg tCO2 per vessel transit (EEZ crossing)

export function PartnershipCalculatorSection() {
    const t = useTranslations('Partnership');

    const [vessels, setVessels] = React.useState(500);
    const [avgCo2, setAvgCo2] = React.useState(DEFAULT_AVG_CO2);
    const [taxRate, setTaxRate] = React.useState(DEFAULT_TAX_RATE);

    const totalCo2 = vessels * avgCo2;
    const annualRevenue = totalCo2 * taxRate;
    const monthlyRevenue = annualRevenue / 12;

    return (
        <section className="py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                <div className="mb-10 max-w-3xl">
                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400 mb-3">{t('calc_badge')}</p>
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                        {t('calc_title')}
                    </h2>
                    <p className="text-sm sm:text-base leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('calc_desc')}
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left — Inputs */}
                    <div
                        className="rounded-2xl p-6 sm:p-8"
                        style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                    >
                        <h3 className="text-sm font-bold uppercase tracking-wider mb-6 flex items-center gap-2" style={{ color: 'var(--ais-page-text-muted)' }}>
                            <Calculator className="w-4 h-4 text-emerald-400" />
                            {t('calc_inputs')}
                        </h3>

                        {/* Vessels per year */}
                        <div className="mb-6">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-muted)' }}>
                                    {t('calc_vessels_label')}
                                </label>
                                <span className="text-sm font-bold text-emerald-400">{vessels.toLocaleString()}</span>
                            </div>
                            <input
                                type="range"
                                min={50}
                                max={5000}
                                step={50}
                                value={vessels}
                                onChange={(e) => setVessels(Number(e.target.value))}
                                className="w-full accent-emerald-500"
                            />
                            <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--ais-page-text-dim)' }}>
                                <span>50</span>
                                <span>5,000</span>
                            </div>
                        </div>

                        {/* Avg CO2 per transit */}
                        <div className="mb-6">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-muted)' }}>
                                    {t('calc_co2_label')}
                                </label>
                                <span className="text-sm font-bold text-emerald-400">{avgCo2} tCO₂</span>
                            </div>
                            <input
                                type="range"
                                min={10}
                                max={500}
                                step={5}
                                value={avgCo2}
                                onChange={(e) => setAvgCo2(Number(e.target.value))}
                                className="w-full accent-emerald-500"
                            />
                            <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--ais-page-text-dim)' }}>
                                <span>10 tCO₂</span>
                                <span>500 tCO₂</span>
                            </div>
                        </div>

                        {/* Tax rate */}
                        <div className="mb-4">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-muted)' }}>
                                    {t('calc_rate_label')}
                                </label>
                                <span className="text-sm font-bold text-yellow-400">${taxRate}/tCO₂</span>
                            </div>
                            <input
                                type="range"
                                min={5}
                                max={100}
                                step={1}
                                value={taxRate}
                                onChange={(e) => setTaxRate(Number(e.target.value))}
                                className="w-full accent-yellow-500"
                            />
                            <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--ais-page-text-dim)' }}>
                                <span>$5</span>
                                <span>$100 (IMO)</span>
                            </div>
                        </div>

                        <p className="text-[10px] mt-4" style={{ color: 'var(--ais-page-text-dim)' }}>
                            {t('calc_disclaimer')}
                        </p>
                    </div>

                    {/* Right — Results */}
                    <div className="flex flex-col gap-4">
                        {/* Annual Revenue */}
                        <div
                            className="rounded-2xl p-6 sm:p-8 flex-1"
                            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                                    <DollarSign className="w-5 h-5 text-yellow-400" />
                                </div>
                                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-muted)' }}>
                                    {t('calc_annual_revenue')}
                                </p>
                            </div>
                            <p className="text-4xl sm:text-5xl font-black tracking-tight bg-gradient-to-r from-yellow-400 to-emerald-400 bg-clip-text text-transparent">
                                ${annualRevenue.toLocaleString()}
                            </p>
                            <p className="text-sm mt-2" style={{ color: 'var(--ais-page-text-muted)' }}>
                                ~${monthlyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}/{t('calc_per_month')}
                            </p>
                        </div>

                        {/* KPIs */}
                        <div className="grid grid-cols-2 gap-4">
                            <div
                                className="rounded-2xl p-5"
                                style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                            >
                                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-3">
                                    <Ship className="w-4 h-4 text-emerald-400" />
                                </div>
                                <p className="text-xl font-bold" style={{ color: 'var(--ais-page-text)' }}>{vessels.toLocaleString()}</p>
                                <p className="text-[10px] font-medium" style={{ color: 'var(--ais-page-text-dim)' }}>{t('calc_vessels_year')}</p>
                            </div>
                            <div
                                className="rounded-2xl p-5"
                                style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                            >
                                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center mb-3">
                                    <Wind className="w-4 h-4 text-blue-400" />
                                </div>
                                <p className="text-xl font-bold" style={{ color: 'var(--ais-page-text)' }}>{totalCo2.toLocaleString()}</p>
                                <p className="text-[10px] font-medium" style={{ color: 'var(--ais-page-text-dim)' }}>{t('calc_total_co2')}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
