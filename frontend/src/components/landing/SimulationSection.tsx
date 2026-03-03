'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Ship, Anchor, TrendingUp, TreePine, Home, ArrowRight, AlertCircle, Landmark, Building2 } from 'lucide-react';
import {
    calculateSimulation,
    calculateCompanySimulation,
    formatCurrency,
    formatNumber,
    ShipType,
} from '@/domain/simulation/simulationEngine';
import { simulationDefaults, companySimulationDefaults, simulationSliderRanges } from '@/mock/datas';

type SimulationMode = 'STATE' | 'COMPANY';

export function SimulationSection() {
    const t = useTranslations('Landing');

    const [mode, setMode] = React.useState<SimulationMode>('STATE');

    // State Params
    const [shipsPerMonth, setShipsPerMonth] = React.useState(simulationDefaults.shipsPerMonth);
    const [avgEmissions, setAvgEmissions] = React.useState(simulationDefaults.avgEmissionsPerShip);

    // Company Params
    const [fleetSize, setFleetSize] = React.useState(companySimulationDefaults.fleetSize);
    const [daysInZee, setDaysInZee] = React.useState(companySimulationDefaults.daysInZeePerShip);

    // Shared Params
    const [taxRate, setTaxRate] = React.useState(simulationDefaults.taxRatePerTon);
    const [shipType, setShipType] = React.useState<ShipType>(simulationDefaults.shipType);

    const result = React.useMemo(
        () =>
            calculateSimulation({
                shipsPerMonth,
                avgEmissionsPerShip: avgEmissions,
                taxRatePerTon: taxRate,
                shipType,
            }),
        [shipsPerMonth, avgEmissions, taxRate, shipType]
    );

    const companyResult = React.useMemo(
        () =>
            calculateCompanySimulation({
                fleetSize,
                daysInZeePerShip: daysInZee,
                taxRatePerTon: taxRate,
                shipType,
            }),
        [fleetSize, daysInZee, taxRate, shipType]
    );

    return (
        <section className="py-20 px-6 bg-[#0A1110] relative">
            {/* Background decorative element */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-emerald-900/10 rounded-full blur-[150px]" />

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Section Header */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[10px] font-bold tracking-[0.15em] uppercase mb-6">
                        {t('simulation_badge')}
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                        {t('simulation_title')}
                    </h2>
                    <p className="text-slate-400 text-base max-w-2xl mx-auto">
                        {t('simulation_subtitle')}
                    </p>
                </div>

                {/* Mode Toggle */}
                <div className="flex justify-center mb-10">
                    <div className="inline-flex bg-[#111C18] rounded-xl p-1 border border-white/5">
                        <button
                            onClick={() => setMode('STATE')}
                            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${mode === 'STATE'
                                    ? 'bg-emerald-500 text-white shadow-lg'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            <Landmark className="w-4 h-4" />
                            {t('sim_tab_state')}
                        </button>
                        <button
                            onClick={() => setMode('COMPANY')}
                            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${mode === 'COMPANY'
                                    ? 'bg-amber-500 text-amber-950 shadow-lg'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            <Building2 className="w-4 h-4" />
                            {t('sim_tab_company')}
                        </button>
                    </div>
                </div>

                {/* Simulation Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left: Parameters Panel */}
                    <div className="bg-[#111C18] rounded-2xl p-8 border border-white/5">
                        <div className="flex items-center gap-3 mb-8">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${mode === 'STATE' ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                                <Ship className={`w-4 h-4 ${mode === 'STATE' ? 'text-emerald-400' : 'text-amber-400'}`} />
                            </div>
                            <h3 className="text-lg font-bold text-white">{t('sim_params_title')}</h3>
                        </div>

                        {mode === 'STATE' ? (
                            <>
                                {/* Slider: Ships per Month */}
                                <div className="mb-8">
                                    <div className="flex justify-between items-center mb-3">
                                        <label className="text-sm font-medium text-slate-300">{t('sim_ships_label')}</label>
                                        <span className="text-sm font-bold text-yellow-400 bg-yellow-500/10 px-2.5 py-0.5 rounded-md">
                                            {shipsPerMonth}
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min={simulationSliderRanges.shipsPerMonth.min}
                                        max={simulationSliderRanges.shipsPerMonth.max}
                                        step={simulationSliderRanges.shipsPerMonth.step}
                                        value={shipsPerMonth}
                                        onChange={(e) => setShipsPerMonth(Number(e.target.value))}
                                        className="w-full"
                                    />
                                    <div className="flex justify-between text-[10px] text-slate-600 mt-1.5">
                                        <span>{simulationSliderRanges.shipsPerMonth.min}</span>
                                        <span>{simulationSliderRanges.shipsPerMonth.max}</span>
                                    </div>
                                </div>

                                {/* Slider: Avg Emissions */}
                                <div className="mb-8">
                                    <div className="flex justify-between items-center mb-3">
                                        <label className="text-sm font-medium text-slate-300">{t('sim_emissions_label')}</label>
                                        <span className="text-sm font-bold text-yellow-400 bg-yellow-500/10 px-2.5 py-0.5 rounded-md">
                                            {avgEmissions}
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min={simulationSliderRanges.avgEmissionsPerShip.min}
                                        max={simulationSliderRanges.avgEmissionsPerShip.max}
                                        step={simulationSliderRanges.avgEmissionsPerShip.step}
                                        value={avgEmissions}
                                        onChange={(e) => setAvgEmissions(Number(e.target.value))}
                                        className="w-full"
                                    />
                                    <div className="flex justify-between text-[10px] text-slate-600 mt-1.5">
                                        <span>{simulationSliderRanges.avgEmissionsPerShip.min}</span>
                                        <span>{simulationSliderRanges.avgEmissionsPerShip.max}</span>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* Slider: Fleet Size */}
                                <div className="mb-8">
                                    <div className="flex justify-between items-center mb-3">
                                        <label className="text-sm font-medium text-slate-300">{t('sim_fleet_size')}</label>
                                        <span className="text-sm font-bold text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-md">
                                            {fleetSize}
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min={simulationSliderRanges.fleetSize.min}
                                        max={simulationSliderRanges.fleetSize.max}
                                        step={simulationSliderRanges.fleetSize.step}
                                        value={fleetSize}
                                        onChange={(e) => setFleetSize(Number(e.target.value))}
                                        className="w-full accent-amber-500"
                                    />
                                    <div className="flex justify-between text-[10px] text-slate-600 mt-1.5">
                                        <span>{simulationSliderRanges.fleetSize.min}</span>
                                        <span>{simulationSliderRanges.fleetSize.max}</span>
                                    </div>
                                </div>

                                {/* Slider: Days in ZEE */}
                                <div className="mb-8">
                                    <div className="flex justify-between items-center mb-3">
                                        <label className="text-sm font-medium text-slate-300">{t('sim_days_in_zee')}</label>
                                        <span className="text-sm font-bold text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-md">
                                            {daysInZee}
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min={simulationSliderRanges.daysInZeePerShip.min}
                                        max={simulationSliderRanges.daysInZeePerShip.max}
                                        step={simulationSliderRanges.daysInZeePerShip.step}
                                        value={daysInZee}
                                        onChange={(e) => setDaysInZee(Number(e.target.value))}
                                        className="w-full accent-amber-500"
                                    />
                                    <div className="flex justify-between text-[10px] text-slate-600 mt-1.5">
                                        <span>{simulationSliderRanges.daysInZeePerShip.min}</span>
                                        <span>{simulationSliderRanges.daysInZeePerShip.max}</span>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Slider: Tax Rate (Shared) */}
                        <div className="mb-8">
                            <div className="flex justify-between items-center mb-3">
                                <label className="text-sm font-medium text-slate-300">{t('sim_tax_label')}</label>
                                <span className={`text-sm font-bold px-2.5 py-0.5 rounded-md ${mode === 'STATE' ? 'text-yellow-400 bg-yellow-500/10' : 'text-amber-400 bg-amber-500/10'}`}>
                                    ${taxRate}
                                </span>
                            </div>
                            <input
                                type="range"
                                min={simulationSliderRanges.taxRatePerTon.min}
                                max={simulationSliderRanges.taxRatePerTon.max}
                                step={simulationSliderRanges.taxRatePerTon.step}
                                value={taxRate}
                                onChange={(e) => setTaxRate(Number(e.target.value))}
                                className="w-full"
                            />
                            <div className="flex justify-between text-[10px] text-slate-600 mt-1.5">
                                <span>${simulationSliderRanges.taxRatePerTon.min}</span>
                                <span>${simulationSliderRanges.taxRatePerTon.max}</span>
                            </div>
                        </div>

                        {/* Ship Type Toggle */}
                        <div>
                            <label className="text-sm font-medium text-slate-300 block mb-3">{t('sim_ship_type_label')}</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setShipType(ShipType.CARGO)}
                                    className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all ${shipType === ShipType.CARGO
                                            ? mode === 'STATE'
                                                ? 'bg-emerald-500/15 border-2 border-emerald-500/40 text-emerald-400'
                                                : 'bg-amber-500/15 border-2 border-amber-500/40 text-amber-500'
                                            : 'bg-slate-800/30 border border-white/5 text-slate-400 hover:border-white/10'
                                        }`}
                                >
                                    <Ship className="w-4 h-4" />
                                    {t('sim_ship_cargo')}
                                </button>
                                <button
                                    onClick={() => setShipType(ShipType.TANKER)}
                                    className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all ${shipType === ShipType.TANKER
                                            ? mode === 'STATE'
                                                ? 'bg-emerald-500/15 border-2 border-emerald-500/40 text-emerald-400'
                                                : 'bg-amber-500/15 border-2 border-amber-500/40 text-amber-500'
                                            : 'bg-slate-800/30 border border-white/5 text-slate-400 hover:border-white/10'
                                        }`}
                                >
                                    <Anchor className="w-4 h-4" />
                                    {t('sim_ship_tanker')}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Right: Results Panel */}
                    <div className={`rounded-2xl p-8 border ${mode === 'STATE'
                            ? 'bg-gradient-to-br from-yellow-500/10 via-emerald-500/5 to-transparent border-yellow-500/20'
                            : 'bg-gradient-to-br from-amber-500/10 via-red-500/5 to-transparent border-amber-500/20'
                        }`}>
                        {/* Main Revenue Display */}
                        <div className="mb-8">
                            <div className="flex items-center gap-2 mb-4">
                                <TrendingUp className={`w-4 h-4 ${mode === 'STATE' ? 'text-yellow-400' : 'text-amber-500'}`} />
                                <h3 className={`text-xs font-bold tracking-[0.15em] uppercase ${mode === 'STATE' ? 'text-yellow-400' : 'text-amber-500'}`}>
                                    {mode === 'STATE' ? t('sim_result_title') : t('sim_tax_liability_title')}
                                </h3>
                            </div>
                            <div className="text-5xl md:text-6xl font-bold text-white mb-3 tracking-tight">
                                {mode === 'STATE'
                                    ? formatCurrency(result.monthlyRevenue)
                                    : formatCurrency(companyResult.totalTaxLiability)
                                }
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${mode === 'STATE' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {mode === 'STATE' ? '⬆' : '⬇'} {t('sim_annual_projection')}: {mode === 'STATE'
                                        ? formatCurrency(result.annualProjection)
                                        : formatCurrency(companyResult.annualTaxProjection)}
                                </span>
                            </div>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-4 mb-8">
                            <div className="bg-[#0A1110]/60 rounded-xl p-4 border border-white/5">
                                <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">
                                    {mode === 'STATE' ? t('sim_monthly_emissions') : t('sim_fleet_emissions')}
                                </p>
                                <p className="text-2xl font-bold text-white">
                                    {mode === 'STATE'
                                        ? formatNumber(result.monthlyEmissions)
                                        : formatNumber(companyResult.totalFleetEmissions)
                                    }
                                    <span className="text-xs text-slate-400 font-normal ml-1">t</span>
                                </p>
                                <p className="text-[10px] text-slate-500 mt-1">{mode === 'STATE' ? t('sim_co2_per_month') : ''}</p>
                            </div>
                            <div className="bg-[#0A1110]/60 rounded-xl p-4 border border-white/5">
                                <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">
                                    {t('sim_price_vessel')}
                                </p>
                                <p className="text-2xl font-bold text-white">
                                    ${mode === 'STATE'
                                        ? formatNumber(result.pricePerVessel)
                                        : formatNumber(companyResult.taxPerVessel)
                                    }
                                </p>
                                <p className="text-[10px] text-slate-500 mt-1">{t('sim_per_vessel')}</p>
                            </div>
                        </div>

                        {/* Environmental Impact or Offset */}
                        {mode === 'STATE' ? (
                            <div className="bg-[#0A1110]/40 rounded-xl p-5 border border-white/5 mb-6">
                                <h4 className="text-xs font-bold text-emerald-400 mb-3 flex items-center gap-2">
                                    <TreePine className="w-3.5 h-3.5" />
                                    {t('sim_impact_title')}
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex items-center gap-3">
                                        <TreePine className="w-5 h-5 text-emerald-500 shrink-0" />
                                        <div>
                                            <p className="text-lg font-bold text-white">{formatNumber(result.treesEquivalent)}</p>
                                            <p className="text-[10px] text-slate-500">{t('sim_trees_label')}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Home className="w-5 h-5 text-yellow-500 shrink-0" />
                                        <div>
                                            <p className="text-lg font-bold text-white">{formatNumber(result.householdsEquivalent)}</p>
                                            <p className="text-[10px] text-slate-500">{t('sim_households_label')}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-[#0A1110]/40 rounded-xl p-5 border border-white/5 mb-6">
                                <h4 className="text-xs font-bold text-amber-500 mb-3 flex items-center gap-2">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    {t('sim_compliance_cost')}
                                </h4>
                                <div className="flex justify-between items-center">
                                    <div>
                                        <p className="text-lg font-bold text-white">{formatCurrency(companyResult.offsetCostEstimate)}</p>
                                        <p className="text-[10px] text-slate-500">{formatNumber(companyResult.offsetRequiredTons)} tCO2 {t('sim_offset_req')}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* CTA Button */}
                        <button className={`w-full py-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 group ${mode === 'STATE'
                                ? 'bg-yellow-500 hover:bg-yellow-400 text-yellow-950 hover:shadow-[0_0_20px_rgba(234,179,8,0.3)]'
                                : 'bg-amber-600 hover:bg-amber-500 text-white hover:shadow-[0_0_20px_rgba(217,119,6,0.3)]'
                            }`}>
                            {mode === 'STATE' ? t('sim_cta') : t('sim_company_cta')}
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>

                {/* Disclaimer */}
                <div className="mt-6 flex items-start gap-3 text-[11px] text-slate-600 max-w-4xl mx-auto">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-slate-700" />
                    <p className="leading-relaxed">{t('sim_disclaimer')}</p>
                </div>
            </div>
        </section>
    );
}

