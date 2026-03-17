'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    Calculator, Ship, RefreshCw, FileText, Info, ChevronDown,
    AlertTriangle, CheckCircle2, Anchor, Navigation, HelpCircle,
} from 'lucide-react';
import { useTaxConfigs } from '@/hooks/useTaxConfigs';
import { VesselCategory, JurisdictionZone, TaxConfiguration } from '@/types/secure';

// ── Constants ─────────────────────────────────────────────────────────────────

// Specific Fuel Oil Consumption g/kWh by category (approximate IMO values)
const SFOC_BY_CATEGORY: Record<string, number> = {
    [VesselCategory.CONTAINER]:   175,
    [VesselCategory.CARGO]:       185,
    [VesselCategory.TANKER]:      180,
    [VesselCategory.BULK_CARRIER]:190,
    [VesselCategory.FERRY]:       210,
    [VesselCategory.NAVAL]:       200,
    [VesselCategory.SCIENTIFIC]:  195,
};

// CO2 emission factor for HFO (tCO2 / tFuel) — IMO MEPC standard
const CO2_FACTOR_HFO = 3.206;
// CO2 emission factor for MDO/MGO
const CO2_FACTOR_MDO = 3.206;

// Load factor at sea vs at port
const LOAD_FACTOR_SEA  = 0.75;   // 75% MCR
const LOAD_FACTOR_PORT = 0.10;   // 10% MCR (aux engines / hotel load)

const CATEGORY_I18N_KEY: Record<string, string> = {
    [VesselCategory.CONTAINER]:   'simulator_cat_container',
    [VesselCategory.CARGO]:       'simulator_cat_cargo',
    [VesselCategory.TANKER]:      'simulator_cat_tanker',
    [VesselCategory.BULK_CARRIER]:'simulator_cat_bulk',
    [VesselCategory.FERRY]:       'simulator_cat_ferry',
};

const CATEGORY_ICONS: Record<string, string> = {
    [VesselCategory.CONTAINER]:   '🟦',
    [VesselCategory.CARGO]:       '🟩',
    [VesselCategory.TANKER]:      '🟥',
    [VesselCategory.BULK_CARRIER]:'🟧',
    [VesselCategory.FERRY]:       '🟪',
};

// ── Calculation engine ────────────────────────────────────────────────────────

interface SimInputs {
    category: VesselCategory;
    enginePowerKw: number;       // kW
    grossTonnage: number;        // GT
    speedKnots: number;
    eezDistanceNm: number;       // nautical miles in EEZ
    portStayHours: number;
    includePortVicinity: boolean;
    fuelType: 'HFO' | 'MDO';
}

interface SimResult {
    eezTransitHours: number;
    eezFuelTons: number;
    eezCo2Tons: number;
    eezRate: number;              // USD/tCO2
    eezMultiplier: number;
    eezTaxUsd: number;

    portFuelTons: number;
    portCo2Tons: number;
    portRate: number;
    portMultiplier: number;
    portTaxUsd: number;

    totalCo2Tons: number;
    totalTaxUsd: number;
    effectiveRate: number;        // USD/tCO2 blended
}

function calculate(inputs: SimInputs, taxConfigs: TaxConfiguration[]): SimResult {
    const sfoc       = SFOC_BY_CATEGORY[inputs.category] ?? 185;
    const co2Factor  = inputs.fuelType === 'HFO' ? CO2_FACTOR_HFO : CO2_FACTOR_MDO;

    // EEZ transit
    const eezHours   = inputs.speedKnots > 0 ? inputs.eezDistanceNm / inputs.speedKnots : 0;
    const eezFuel    = (inputs.enginePowerKw * LOAD_FACTOR_SEA * sfoc * eezHours) / 1_000_000; // tons
    const eezCo2    = eezFuel * co2Factor;

    const eezConfig  = taxConfigs.find(
        (c) => c.jurisdictionZone === JurisdictionZone.EEZ && c.vesselCategory === inputs.category && c.status === 'ACTIVE'
    );
    const eezRate    = eezConfig?.baseRateUsdPerTco2 ?? 20;
    const eezMult    = eezConfig?.multiplier ?? 1.0;
    const eezTax     = eezCo2 * eezRate * eezMult;

    // Port stay
    const portFuel   = (inputs.enginePowerKw * LOAD_FACTOR_PORT * sfoc * inputs.portStayHours) / 1_000_000;
    const portCo2    = portFuel * co2Factor;

    const portConfig = taxConfigs.find(
        (c) => c.jurisdictionZone === JurisdictionZone.PORT_VICINITY && c.vesselCategory === inputs.category && c.status === 'ACTIVE'
    ) ?? taxConfigs.find(
        (c) => c.jurisdictionZone === JurisdictionZone.PORT_VICINITY && c.status === 'ACTIVE'
    );
    const portRate   = portConfig?.baseRateUsdPerTco2 ?? 15;
    const portMult   = portConfig?.multiplier ?? 1.0;
    const portTax    = inputs.includePortVicinity ? portCo2 * portRate * portMult : 0;
    const portTaxCo2 = inputs.includePortVicinity ? portCo2 : 0;

    const totalCo2   = eezCo2 + portTaxCo2;
    const totalTax   = eezTax + portTax;
    const effective  = totalCo2 > 0 ? totalTax / totalCo2 : 0;

    return {
        eezTransitHours: eezHours,
        eezFuelTons: eezFuel,
        eezCo2Tons: eezCo2,
        eezRate,
        eezMultiplier: eezMult,
        eezTaxUsd: eezTax,
        portFuelTons: portFuel,
        portCo2Tons: portCo2,
        portRate,
        portMultiplier: portMult,
        portTaxUsd: portTax,
        totalCo2Tons: totalCo2,
        totalTaxUsd: totalTax,
        effectiveRate: effective,
    };
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 1) {
    return n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtUsd(n: number) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function Label({ children }: { children: React.ReactNode }) {
    return (
        <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--os-text-muted)' }}>
            {children}
        </label>
    );
}

function NumberInput({
    value, onChange, min = 0, max, step = 1, unit,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string }) {
    return (
        <div className="flex items-center">
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(e) => onChange(Number(e.target.value))}
                className="flex-1 h-10 px-3 rounded-l-xl text-sm outline-none tabular-nums appearance-none"
                style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', borderRight: unit ? 'none' : undefined, color: 'var(--os-text-primary)' }}
            />
            {unit && (
                <span
                    className="h-10 px-3 flex items-center text-xs rounded-r-xl border border-l-0 flex-shrink-0"
                    style={{ backgroundColor: 'var(--os-surface-3)', borderColor: 'var(--os-border)', color: 'var(--os-text-muted)' }}
                >
                    {unit}
                </span>
            )}
        </div>
    );
}

function MetricRow({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
    return (
        <div className="flex items-start justify-between py-2.5 border-b last:border-0" style={{ borderColor: 'var(--os-border)' }}>
            <div>
                <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>{label}</p>
                {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--os-text-muted)', opacity: 0.6 }}>{sub}</p>}
            </div>
            <span
                className={`text-sm font-bold tabular-nums ${highlight ? '' : ''}`}
                style={{ color: highlight ? '#10B981' : 'var(--os-text-primary)' }}
            >
                {value}
            </span>
        </div>
    );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}>
            <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 mb-4" style={{ color: 'var(--os-text-muted)' }}>
                {icon}
                {title}
            </h3>
            {children}
        </div>
    );
}

// ── Preset vessels ────────────────────────────────────────────────────────────

const PRESETS = [
    { label: 'Feeder Container',  category: VesselCategory.CONTAINER,    enginePowerKw: 12_000, grossTonnage: 18_000, speedKnots: 19 },
    { label: 'Large Container',   category: VesselCategory.CONTAINER,    enginePowerKw: 48_840, grossTonnage: 42_000, speedKnots: 24 },
    { label: 'Cargo General',     category: VesselCategory.CARGO,        enginePowerKw: 8_500,  grossTonnage: 12_000, speedKnots: 16 },
    { label: 'Pétrolier Moyen',   category: VesselCategory.TANKER,       enginePowerKw: 19_620, grossTonnage: 75_000, speedKnots: 15 },
    { label: 'Vraquier Panamax',  category: VesselCategory.BULK_CARRIER, enginePowerKw: 14_280, grossTonnage: 85_000, speedKnots: 14 },
];

// ── Main component ────────────────────────────────────────────────────────────

export function TaxSimulatorPage() {
    const t = useTranslations('DashboardPages');
    const { data: taxConfigs } = useTaxConfigs();
    const [inputs, setInputs] = React.useState<SimInputs>({
        category:            VesselCategory.CONTAINER,
        enginePowerKw:       12_000,
        grossTonnage:        18_000,
        speedKnots:          19,
        eezDistanceNm:       120,
        portStayHours:       24,
        includePortVicinity: true,
        fuelType:            'HFO',
    });

    const result = React.useMemo(() => calculate(inputs, taxConfigs), [inputs, taxConfigs]);

    function set<K extends keyof SimInputs>(key: K, value: SimInputs[K]) {
        setInputs((prev) => ({ ...prev, [key]: value }));
    }

    function applyPreset(p: typeof PRESETS[0]) {
        setInputs((prev) => ({
            ...prev,
            category:        p.category,
            enginePowerKw:   p.enginePowerKw,
            grossTonnage:    p.grossTonnage,
            speedKnots:      p.speedKnots,
        }));
    }

    const riskLevel = result.totalTaxUsd < 2_000 ? 'low' : result.totalTaxUsd < 8_000 ? 'medium' : 'high';
    const riskColor = { low: '#22C55E', medium: '#F59E0B', high: '#EF4444' }[riskLevel];
    const riskLabel = { low: t('simulator_risk_low'), medium: t('simulator_risk_medium'), high: t('simulator_risk_high') }[riskLevel];

    return (
        <div className="px-3 sm:px-6 py-3 sm:py-6 flex flex-col gap-6">

            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--os-text-primary)' }}>
                        <Calculator className="w-5 h-5 text-emerald-500" />
                        {t('simulator_title')}
                    </h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--os-text-muted)' }}>
                        {t('simulator_subtitle')}
                    </p>
                </div>
                <div
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                    style={{ backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#10B981' }}
                >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t('simulator_official_rates')}
                </div>
            </div>

            {/* Notice */}
            <div
                className="flex items-start gap-3 p-4 rounded-xl text-xs"
                style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}
            >
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#F59E0B' }} />
                <p style={{ color: 'var(--os-text-muted)' }}>
                    {t('simulator_notice')}
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_360px_280px] gap-3 sm:gap-4 lg:gap-6">

                {/* ── Left: Inputs ── */}
                <div className="flex flex-col gap-4">

                    {/* Presets */}
                    <SectionCard title={t('simulator_vessel_profile')} icon={<Ship className="w-3.5 h-3.5" />}>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {PRESETS.map((p) => (
                                <button
                                    key={p.label}
                                    onClick={() => applyPreset(p)}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                    style={{
                                        backgroundColor: inputs.category === p.category && inputs.enginePowerKw === p.enginePowerKw
                                            ? 'rgba(16,185,129,0.12)'
                                            : 'var(--os-surface-2)',
                                        color: inputs.category === p.category && inputs.enginePowerKw === p.enginePowerKw
                                            ? '#10B981'
                                            : 'var(--os-text-muted)',
                                        border: inputs.category === p.category && inputs.enginePowerKw === p.enginePowerKw
                                            ? '1px solid rgba(16,185,129,0.3)'
                                            : '1px solid var(--os-border)',
                                    }}
                                >
                                    {CATEGORY_ICONS[p.category]} {p.label}
                                </button>
                            ))}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            {/* Category */}
                            <div>
                                <Label>{t('simulator_vessel_type')}</Label>
                                <select
                                    value={inputs.category}
                                    onChange={(e) => set('category', e.target.value as VesselCategory)}
                                    className="w-full h-10 px-3 rounded-xl text-sm outline-none appearance-none"
                                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                                >
                                    {Object.entries(CATEGORY_I18N_KEY).map(([k, i18nKey]) => (
                                        <option key={k} value={k}>{t(i18nKey as Parameters<typeof t>[0])}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Fuel type */}
                            <div>
                                <Label>{t('simulator_fuel_type')}</Label>
                                <select
                                    value={inputs.fuelType}
                                    onChange={(e) => set('fuelType', e.target.value as 'HFO' | 'MDO')}
                                    className="w-full h-10 px-3 rounded-xl text-sm outline-none appearance-none"
                                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                                >
                                    <option value="HFO">{t('simulator_fuel_hfo')}</option>
                                    <option value="MDO">{t('simulator_fuel_mdo')}</option>
                                </select>
                            </div>

                            {/* Engine power */}
                            <div>
                                <Label>{t('simulator_engine_power')}</Label>
                                <NumberInput value={inputs.enginePowerKw} onChange={(v) => set('enginePowerKw', v)} min={500} max={120000} step={100} unit="kW" />
                            </div>

                            {/* GT */}
                            <div>
                                <Label>{t('simulator_gross_tonnage')}</Label>
                                <NumberInput value={inputs.grossTonnage} onChange={(v) => set('grossTonnage', v)} min={500} max={500000} step={500} unit="GT" />
                            </div>

                            {/* Speed */}
                            <div>
                                <Label>{t('simulator_cruising_speed')}</Label>
                                <NumberInput value={inputs.speedKnots} onChange={(v) => set('speedKnots', v)} min={5} max={30} step={0.5} unit={t('simulator_unit_knots')} />
                            </div>
                        </div>
                    </SectionCard>

                    {/* Voyage */}
                    <SectionCard title={t('simulator_voyage_params')} icon={<Navigation className="w-3.5 h-3.5" />}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            <div>
                                <Label>{t('simulator_eez_distance')}</Label>
                                <NumberInput value={inputs.eezDistanceNm} onChange={(v) => set('eezDistanceNm', v)} min={0} max={2000} step={10} unit="NM" />
                                <p className="text-[10px] mt-1" style={{ color: 'var(--os-text-muted)' }}>
                                    {t('simulator_eez_note')}
                                </p>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <Label>{t('simulator_port_stay')}</Label>
                                    <button
                                        onClick={() => set('includePortVicinity', !inputs.includePortVicinity)}
                                        className="text-[10px] font-semibold px-2 py-0.5 rounded-lg transition-all"
                                        style={{
                                            backgroundColor: inputs.includePortVicinity ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                            color: inputs.includePortVicinity ? '#10B981' : 'var(--os-text-muted)',
                                            border: `1px solid ${inputs.includePortVicinity ? 'rgba(16,185,129,0.3)' : 'var(--os-border)'}`,
                                        }}
                                    >
                                        {inputs.includePortVicinity ? `✓ ${t('simulator_port_included')}` : t('simulator_port_excluded')}
                                    </button>
                                </div>
                                <NumberInput value={inputs.portStayHours} onChange={(v) => set('portStayHours', v)} min={0} max={720} step={1} unit={t('simulator_unit_hours')} />
                            </div>
                        </div>
                    </SectionCard>

                    {/* Applied rates table */}
                    <SectionCard title={t('simulator_applicable_rates')} icon={<Info className="w-3.5 h-3.5" />}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr style={{ color: 'var(--os-text-muted)' }}>
                                        <th className="text-left pb-2 font-semibold uppercase tracking-wide text-[10px]">{t('simulator_col_zone')}</th>
                                        <th className="text-left pb-2 font-semibold uppercase tracking-wide text-[10px]">{t('simulator_col_category')}</th>
                                        <th className="text-right pb-2 font-semibold uppercase tracking-wide text-[10px]">{t('simulator_col_base_rate')}</th>
                                        <th className="text-right pb-2 font-semibold uppercase tracking-wide text-[10px]">{t('simulator_col_multiplier')}</th>
                                        <th className="text-right pb-2 font-semibold uppercase tracking-wide text-[10px]">{t('simulator_col_effective_rate')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        {
                                            zone: 'ZEE', cat: CATEGORY_I18N_KEY[inputs.category] ? t(CATEGORY_I18N_KEY[inputs.category] as Parameters<typeof t>[0]) : inputs.category,
                                            base: result.eezRate, mult: result.eezMultiplier,
                                            effective: result.eezRate * result.eezMultiplier,
                                        },
                                        {
                                            zone: 'Port', cat: CATEGORY_I18N_KEY[inputs.category] ? t(CATEGORY_I18N_KEY[inputs.category] as Parameters<typeof t>[0]) : inputs.category,
                                            base: result.portRate, mult: result.portMultiplier,
                                            effective: result.portRate * result.portMultiplier,
                                        },
                                    ].map((row) => (
                                        <tr key={row.zone} className="border-t" style={{ borderColor: 'var(--os-border)' }}>
                                            <td className="py-2" style={{ color: 'var(--os-text-primary)' }}>{row.zone}</td>
                                            <td className="py-2" style={{ color: 'var(--os-text-muted)' }}>{row.cat}</td>
                                            <td className="py-2 text-right tabular-nums" style={{ color: 'var(--os-text-primary)' }}>${row.base}/tCO₂</td>
                                            <td className="py-2 text-right tabular-nums" style={{ color: 'var(--os-text-muted)' }}>×{row.mult.toFixed(1)}</td>
                                            <td className="py-2 text-right tabular-nums font-bold" style={{ color: '#10B981' }}>${(row.effective).toFixed(2)}/tCO₂</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </SectionCard>
                </div>

                {/* ── Right: Results ── */}
                <div className="flex flex-col gap-4">

                    {/* Total */}
                    <div
                        className="rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface)', border: `1px solid ${riskColor}40` }}
                    >
                        <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                                {t('simulator_estimated_tax')}
                            </p>
                            <span
                                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: `${riskColor}18`, color: riskColor }}
                            >
                                {riskLabel}
                            </span>
                        </div>
                        <p className="text-4xl font-bold tabular-nums mt-2" style={{ color: riskColor }}>
                            {fmtUsd(result.totalTaxUsd)}
                        </p>
                        <p className="text-xs mt-1" style={{ color: 'var(--os-text-muted)' }}>
                            {t('simulator_total_estimated')}
                        </p>

                        <div className="mt-4 h-px" style={{ backgroundColor: 'var(--os-border)' }} />

                        <div className="mt-4 flex flex-col gap-2 text-xs" style={{ color: 'var(--os-text-muted)' }}>
                            <div className="flex justify-between">
                                <span>{t('simulator_eez_tax')}</span>
                                <span className="font-semibold tabular-nums" style={{ color: 'var(--os-text-primary)' }}>{fmtUsd(result.eezTaxUsd)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>{t('simulator_port_tax')}</span>
                                <span className="font-semibold tabular-nums" style={{ color: 'var(--os-text-primary)' }}>
                                    {inputs.includePortVicinity ? fmtUsd(result.portTaxUsd) : '—'}
                                </span>
                            </div>
                            <div className="flex justify-between border-t pt-2" style={{ borderColor: 'var(--os-border)' }}>
                                <span>{t('simulator_blended_rate')}</span>
                                <span className="font-bold" style={{ color: '#10B981' }}>${fmt(result.effectiveRate, 2)} / tCO₂</span>
                            </div>
                        </div>
                    </div>

                    {/* Emissions breakdown */}
                    <SectionCard title={t('simulator_emissions_detail')} icon={<Anchor className="w-3.5 h-3.5" />}>
                        <MetricRow
                            label={t('simulator_eez_transit_duration')}
                            value={`${fmt(result.eezTransitHours, 1)} h`}
                            sub={`${fmt(inputs.eezDistanceNm, 0)} NM @ ${fmt(inputs.speedKnots, 1)} ${t('simulator_unit_knots')}`}
                        />
                        <MetricRow
                            label={t('simulator_eez_consumption')}
                            value={`${fmt(result.eezFuelTons, 2)} t`}
                            sub={t('simulator_sfoc_formula')}
                        />
                        <MetricRow
                            label={t('simulator_eez_emissions')}
                            value={`${fmt(result.eezCo2Tons, 2)} tCO₂`}
                        />
                        {inputs.includePortVicinity && (
                            <>
                                <MetricRow
                                    label={t('simulator_port_consumption')}
                                    value={`${fmt(result.portFuelTons, 3)} t`}
                                    sub={`MCR 10% × ${inputs.portStayHours} h`}
                                />
                                <MetricRow
                                    label={t('simulator_port_emissions')}
                                    value={`${fmt(result.portCo2Tons, 3)} tCO₂`}
                                />
                            </>
                        )}
                        <MetricRow
                            label={t('simulator_total_emissions')}
                            value={`${fmt(result.totalCo2Tons, 2)} tCO₂`}
                            highlight
                        />
                    </SectionCard>

                    {/* SFOC note */}
                    <div
                        className="rounded-xl p-3 text-[11px] flex items-start gap-2"
                        style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
                    >
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--os-text-muted)' }} />
                        <p style={{ color: 'var(--os-text-muted)' }}>
                            {t('simulator_sfoc_note_used')} <strong style={{ color: 'var(--os-text-primary)' }}>{SFOC_BY_CATEGORY[inputs.category]} g/kWh</strong> {t('simulator_sfoc_note_desc')}
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                        <button
                            className="flex items-center justify-center gap-2 w-full h-11 rounded-xl text-sm font-bold transition-all"
                            style={{ backgroundColor: '#10B981', color: '#fff' }}
                        >
                            <FileText className="w-4 h-4" />
                            {t('simulator_generate_pdf')}
                        </button>
                        <button
                            className="flex items-center justify-center gap-2 w-full h-11 rounded-xl text-sm font-semibold transition-all"
                            style={{ backgroundColor: 'var(--os-surface)', color: 'var(--os-text-muted)', border: '1px solid var(--os-border)' }}
                            onClick={() => setInputs({
                                category: VesselCategory.CONTAINER, enginePowerKw: 12_000, grossTonnage: 18_000,
                                speedKnots: 19, eezDistanceNm: 120, portStayHours: 24,
                                includePortVicinity: true, fuelType: 'HFO',
                            })}
                        >
                            <RefreshCw className="w-4 h-4" />
                            {t('simulator_reset')}
                        </button>
                    </div>
                </div>

                {/* ── Far Right: FAQ ── */}
                <div className="hidden xl:flex flex-col gap-4">
                    <FaqPanel />
                </div>
            </div>
        </div>
    );
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

const FAQ_I18N_KEYS: { q: string; a: string }[] = [
    { q: 'simulator_faq_q1', a: 'simulator_faq_a1' },
    { q: 'simulator_faq_q2', a: 'simulator_faq_a2' },
    { q: 'simulator_faq_q3', a: 'simulator_faq_a3' },
    { q: 'simulator_faq_q4', a: 'simulator_faq_a4' },
    { q: 'simulator_faq_q5', a: 'simulator_faq_a5' },
    { q: 'simulator_faq_q6', a: 'simulator_faq_a6' },
];

function FaqPanel() {
    const t = useTranslations('DashboardPages');
    const [openIdx, setOpenIdx] = React.useState<number | null>(null);

    return (
        <div
            className="rounded-2xl p-4"
            style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
        >
            <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="w-3.5 h-3.5" style={{ color: '#10B981' }} />
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                    {t('simulator_faq_title')}
                </p>
            </div>
            <div className="flex flex-col">
                {FAQ_I18N_KEYS.map((item, i) => {
                    const isOpen = openIdx === i;
                    return (
                        <div
                            key={i}
                            className="border-t first:border-t-0"
                            style={{ borderColor: 'var(--os-border)' }}
                        >
                            <button
                                onClick={() => setOpenIdx(isOpen ? null : i)}
                                className="flex items-start gap-2 w-full py-3 text-left transition-colors"
                            >
                                <ChevronDown
                                    className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 transition-transform"
                                    style={{
                                        color: isOpen ? '#10B981' : 'var(--os-text-muted)',
                                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                    }}
                                />
                                <span
                                    className="text-xs font-semibold"
                                    style={{ color: isOpen ? '#10B981' : 'var(--os-text-primary)' }}
                                >
                                    {t(item.q as Parameters<typeof t>[0])}
                                </span>
                            </button>
                            {isOpen && (
                                <p
                                    className="text-[11px] leading-relaxed pb-3 pl-5.5 ml-[22px]"
                                    style={{ color: 'var(--os-text-muted)' }}
                                >
                                    {t(item.a as Parameters<typeof t>[0])}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
