'use client';

import * as React from 'react';
import {
    Calculator, Ship, RefreshCw, FileText, Info, ChevronDown,
    AlertTriangle, CheckCircle2, Anchor, Navigation, HelpCircle,
} from 'lucide-react';
import { mockTaxConfigs } from '@/mock/datas/secureMock';
import { VesselCategory, JurisdictionZone } from '@/types/secure';

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

const CATEGORY_LABELS: Record<string, string> = {
    [VesselCategory.CONTAINER]:   'Porte-conteneurs',
    [VesselCategory.CARGO]:       'Cargo général',
    [VesselCategory.TANKER]:      'Pétrolier / Tanker',
    [VesselCategory.BULK_CARRIER]:'Vraquier (Bulk)',
    [VesselCategory.FERRY]:       'Ferry passagers',
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

function calculate(inputs: SimInputs): SimResult {
    const sfoc       = SFOC_BY_CATEGORY[inputs.category] ?? 185;
    const co2Factor  = inputs.fuelType === 'HFO' ? CO2_FACTOR_HFO : CO2_FACTOR_MDO;

    // EEZ transit
    const eezHours   = inputs.speedKnots > 0 ? inputs.eezDistanceNm / inputs.speedKnots : 0;
    const eezFuel    = (inputs.enginePowerKw * LOAD_FACTOR_SEA * sfoc * eezHours) / 1_000_000; // tons
    const eezCo2    = eezFuel * co2Factor;

    const eezConfig  = mockTaxConfigs.find(
        (c) => c.jurisdictionZone === JurisdictionZone.EEZ && c.vesselCategory === inputs.category && c.status === 'ACTIVE'
    );
    const eezRate    = eezConfig?.baseRateUsdPerTco2 ?? 20;
    const eezMult    = eezConfig?.multiplier ?? 1.0;
    const eezTax     = eezCo2 * eezRate * eezMult;

    // Port stay
    const portFuel   = (inputs.enginePowerKw * LOAD_FACTOR_PORT * sfoc * inputs.portStayHours) / 1_000_000;
    const portCo2    = portFuel * co2Factor;

    const portConfig = mockTaxConfigs.find(
        (c) => c.jurisdictionZone === JurisdictionZone.PORT_VICINITY && c.vesselCategory === inputs.category && c.status === 'ACTIVE'
    ) ?? mockTaxConfigs.find(
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

    const result = React.useMemo(() => calculate(inputs), [inputs]);

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
    const riskLabel = { low: 'Faible exposition', medium: 'Exposition modérée', high: 'Forte exposition' }[riskLevel];

    return (
        <div className="px-6 py-6 flex flex-col gap-6">

            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--os-text-primary)' }}>
                        <Calculator className="w-5 h-5 text-emerald-500" />
                        Simulateur de Taxe Carbone
                    </h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--os-text-muted)' }}>
                        Estimez votre charge fiscale avant d'entrer dans la ZEE de Somaliland — basé sur les taux officiels en vigueur.
                    </p>
                </div>
                <div
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                    style={{ backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#10B981' }}
                >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Taux officiels au 01/01/2025 — IMO DCS certifié
                </div>
            </div>

            {/* Notice */}
            <div
                className="flex items-start gap-3 p-4 rounded-xl text-xs"
                style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}
            >
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#F59E0B' }} />
                <p style={{ color: 'var(--os-text-muted)' }}>
                    Ce simulateur utilise la méthodologie IMO SFOC (Specific Fuel Oil Consumption) pour estimer les émissions CO₂.
                    Les résultats sont indicatifs. La facture finale est établie sur les données AIS réelles de votre passage.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_360px_280px] gap-6">

                {/* ── Left: Inputs ── */}
                <div className="flex flex-col gap-4">

                    {/* Presets */}
                    <SectionCard title="Profil navire — choisir un modèle type" icon={<Ship className="w-3.5 h-3.5" />}>
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

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Category */}
                            <div>
                                <Label>Type de navire</Label>
                                <select
                                    value={inputs.category}
                                    onChange={(e) => set('category', e.target.value as VesselCategory)}
                                    className="w-full h-10 px-3 rounded-xl text-sm outline-none appearance-none"
                                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                                >
                                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                        <option key={k} value={k}>{v}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Fuel type */}
                            <div>
                                <Label>Type de carburant</Label>
                                <select
                                    value={inputs.fuelType}
                                    onChange={(e) => set('fuelType', e.target.value as 'HFO' | 'MDO')}
                                    className="w-full h-10 px-3 rounded-xl text-sm outline-none appearance-none"
                                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                                >
                                    <option value="HFO">HFO — Fioul lourd (facteur CO₂ : 3.206)</option>
                                    <option value="MDO">MDO / MGO — Gasoil marin (facteur CO₂ : 3.206)</option>
                                </select>
                            </div>

                            {/* Engine power */}
                            <div>
                                <Label>Puissance moteur principal (MCR)</Label>
                                <NumberInput value={inputs.enginePowerKw} onChange={(v) => set('enginePowerKw', v)} min={500} max={120000} step={100} unit="kW" />
                            </div>

                            {/* GT */}
                            <div>
                                <Label>Jauge brute (GT / DWT)</Label>
                                <NumberInput value={inputs.grossTonnage} onChange={(v) => set('grossTonnage', v)} min={500} max={500000} step={500} unit="GT" />
                            </div>

                            {/* Speed */}
                            <div>
                                <Label>Vitesse de croisière</Label>
                                <NumberInput value={inputs.speedKnots} onChange={(v) => set('speedKnots', v)} min={5} max={30} step={0.5} unit="nœuds" />
                            </div>
                        </div>
                    </SectionCard>

                    {/* Voyage */}
                    <SectionCard title="Paramètres du voyage" icon={<Navigation className="w-3.5 h-3.5" />}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <Label>Distance en ZEE (transit)</Label>
                                <NumberInput value={inputs.eezDistanceNm} onChange={(v) => set('eezDistanceNm', v)} min={0} max={2000} step={10} unit="NM" />
                                <p className="text-[10px] mt-1" style={{ color: 'var(--os-text-muted)' }}>
                                    ZEE Somaliland : 200 NM depuis la ligne de base
                                </p>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <Label>Escale portuaire</Label>
                                    <button
                                        onClick={() => set('includePortVicinity', !inputs.includePortVicinity)}
                                        className="text-[10px] font-semibold px-2 py-0.5 rounded-lg transition-all"
                                        style={{
                                            backgroundColor: inputs.includePortVicinity ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                            color: inputs.includePortVicinity ? '#10B981' : 'var(--os-text-muted)',
                                            border: `1px solid ${inputs.includePortVicinity ? 'rgba(16,185,129,0.3)' : 'var(--os-border)'}`,
                                        }}
                                    >
                                        {inputs.includePortVicinity ? '✓ Incluse' : 'Exclue'}
                                    </button>
                                </div>
                                <NumberInput value={inputs.portStayHours} onChange={(v) => set('portStayHours', v)} min={0} max={720} step={1} unit="heures" />
                            </div>
                        </div>
                    </SectionCard>

                    {/* Applied rates table */}
                    <SectionCard title="Taux applicables (officiels)" icon={<Info className="w-3.5 h-3.5" />}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr style={{ color: 'var(--os-text-muted)' }}>
                                        <th className="text-left pb-2 font-semibold uppercase tracking-wide text-[10px]">Zone</th>
                                        <th className="text-left pb-2 font-semibold uppercase tracking-wide text-[10px]">Catégorie</th>
                                        <th className="text-right pb-2 font-semibold uppercase tracking-wide text-[10px]">Taux base</th>
                                        <th className="text-right pb-2 font-semibold uppercase tracking-wide text-[10px]">Multiplicateur</th>
                                        <th className="text-right pb-2 font-semibold uppercase tracking-wide text-[10px]">Taux effectif</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        {
                                            zone: 'ZEE', cat: CATEGORY_LABELS[inputs.category] ?? inputs.category,
                                            base: result.eezRate, mult: result.eezMultiplier,
                                            effective: result.eezRate * result.eezMultiplier,
                                        },
                                        {
                                            zone: 'Port', cat: CATEGORY_LABELS[inputs.category] ?? inputs.category,
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
                                Taxe carbone estimée
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
                            Total estimé — ZEE + Escale
                        </p>

                        <div className="mt-4 h-px" style={{ backgroundColor: 'var(--os-border)' }} />

                        <div className="mt-4 flex flex-col gap-2 text-xs" style={{ color: 'var(--os-text-muted)' }}>
                            <div className="flex justify-between">
                                <span>Taxe ZEE (transit)</span>
                                <span className="font-semibold tabular-nums" style={{ color: 'var(--os-text-primary)' }}>{fmtUsd(result.eezTaxUsd)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Taxe escale portuaire</span>
                                <span className="font-semibold tabular-nums" style={{ color: 'var(--os-text-primary)' }}>
                                    {inputs.includePortVicinity ? fmtUsd(result.portTaxUsd) : '—'}
                                </span>
                            </div>
                            <div className="flex justify-between border-t pt-2" style={{ borderColor: 'var(--os-border)' }}>
                                <span>Taux effectif blended</span>
                                <span className="font-bold" style={{ color: '#10B981' }}>${fmt(result.effectiveRate, 2)} / tCO₂</span>
                            </div>
                        </div>
                    </div>

                    {/* Emissions breakdown */}
                    <SectionCard title="Détail des émissions" icon={<Anchor className="w-3.5 h-3.5" />}>
                        <MetricRow
                            label="Durée transit ZEE"
                            value={`${fmt(result.eezTransitHours, 1)} h`}
                            sub={`${fmt(inputs.eezDistanceNm, 0)} NM à ${fmt(inputs.speedKnots, 1)} nœuds`}
                        />
                        <MetricRow
                            label="Consommation ZEE"
                            value={`${fmt(result.eezFuelTons, 2)} t`}
                            sub="SFOC × MCR 75% × heures"
                        />
                        <MetricRow
                            label="Émissions ZEE"
                            value={`${fmt(result.eezCo2Tons, 2)} tCO₂`}
                        />
                        {inputs.includePortVicinity && (
                            <>
                                <MetricRow
                                    label="Consommation escale"
                                    value={`${fmt(result.portFuelTons, 3)} t`}
                                    sub={`MCR 10% × ${inputs.portStayHours} h`}
                                />
                                <MetricRow
                                    label="Émissions escale"
                                    value={`${fmt(result.portCo2Tons, 3)} tCO₂`}
                                />
                            </>
                        )}
                        <MetricRow
                            label="Émissions totales"
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
                            SFOC utilisé : <strong style={{ color: 'var(--os-text-primary)' }}>{SFOC_BY_CATEGORY[inputs.category]} g/kWh</strong> —
                            valeur approximative IMO par catégorie. Pour une estimation précise, fournissez la valeur réelle SFOC de votre navire.
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                        <button
                            className="flex items-center justify-center gap-2 w-full h-11 rounded-xl text-sm font-bold transition-all"
                            style={{ backgroundColor: '#10B981', color: '#fff' }}
                        >
                            <FileText className="w-4 h-4" />
                            Générer une pré-estimation PDF
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
                            Réinitialiser
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

const FAQ_ITEMS: { q: string; a: string }[] = [
    {
        q: 'Comment est calculée la taxe carbone ?',
        a: 'La taxe est basée sur les émissions CO₂ estimées via la méthodologie IMO SFOC (Specific Fuel Oil Consumption). Les émissions = consommation de carburant × facteur d\'émission CO₂ du carburant. La taxe = émissions × taux officiel × multiplicateur par zone.',
    },
    {
        q: 'Quelle est la différence entre taxe ZEE et taxe portuaire ?',
        a: 'La taxe ZEE couvre le transit dans la Zone Économique Exclusive (200 NM). La taxe portuaire s\'applique pendant l\'escale au port (moteurs auxiliaires). Les taux et multiplicateurs peuvent différer selon la zone.',
    },
    {
        q: 'Le résultat est-il contractuel ?',
        a: 'Non. Cette estimation est indicative. La facture finale (pro-forma) est calculée à partir des données AIS réelles enregistrées lors de votre passage dans la ZEE et au port.',
    },
    {
        q: 'Qu\'est-ce que le SFOC ?',
        a: 'Le Specific Fuel Oil Consumption (g/kWh) mesure la consommation de carburant par unité d\'énergie produite par le moteur. Chaque type de navire a un SFOC moyen. Pour une estimation précise, utilisez le SFOC réel de votre navire.',
    },
    {
        q: 'Comment réduire ma taxe carbone ?',
        a: 'Réduisez la vitesse (slow steaming), utilisez du carburant à faible facteur CO₂ (LNG, méthanol), optimisez la durée d\'escale, ou obtenez des crédits carbone via les projets Africgreen certifiés.',
    },
    {
        q: 'Existe-t-il des exemptions ?',
        a: 'Oui. Les navires de recherche scientifique, les bâtiments militaires et certains navires sous accords bilatéraux peuvent bénéficier d\'exemptions partielles ou totales. Contactez l\'autorité portuaire pour plus d\'informations.',
    },
];

function FaqPanel() {
    const [openIdx, setOpenIdx] = React.useState<number | null>(null);

    return (
        <div
            className="rounded-2xl p-4"
            style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
        >
            <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="w-3.5 h-3.5" style={{ color: '#10B981' }} />
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                    Questions fréquentes
                </p>
            </div>
            <div className="flex flex-col">
                {FAQ_ITEMS.map((item, i) => {
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
                                    {item.q}
                                </span>
                            </button>
                            {isOpen && (
                                <p
                                    className="text-[11px] leading-relaxed pb-3 pl-5.5 ml-[22px]"
                                    style={{ color: 'var(--os-text-muted)' }}
                                >
                                    {item.a}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
