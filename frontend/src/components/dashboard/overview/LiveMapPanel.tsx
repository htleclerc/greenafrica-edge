'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Layers, Filter, ZoomIn, ZoomOut, RefreshCw, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsBadge } from '@/components/ui/OsBadge';
import { useVessels } from '@/hooks/useVessels';
import { VesselComplianceStatus, SecureVessel } from '@/types/secure';

// ── Leaflet loaded client-side only ──────────────────────────────────────────

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false, loading: () => <MapSkeleton /> });

function MapSkeleton() {
    return (
        <div className="flex-1 flex items-center justify-center bg-[#060D1A]">
            <div className="flex items-center gap-2 text-[var(--os-text-muted)]">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-xs">Loading map…</span>
            </div>
        </div>
    );
}

// ── Status configs ───────────────────────────────────────────────────────────

const dotColor: Record<VesselComplianceStatus, string> = {
    [VesselComplianceStatus.COMPLIANT]:     '#22C55E',
    [VesselComplianceStatus.PAYMENT_DUE]:   '#EF4444',
    [VesselComplianceStatus.PROCESSING]:    '#F97316',
    [VesselComplianceStatus.NON_COMPLIANT]: '#EF4444',
    [VesselComplianceStatus.APPROACHING]:   '#F59E0B',
    [VesselComplianceStatus.EXEMPT]:        '#38BDF8',
};

const dotVariant: Record<VesselComplianceStatus, Parameters<typeof OsBadge>[0]['variant']> = {
    [VesselComplianceStatus.COMPLIANT]:     'compliant',
    [VesselComplianceStatus.PAYMENT_DUE]:   'payment_due',
    [VesselComplianceStatus.PROCESSING]:    'processing',
    [VesselComplianceStatus.NON_COMPLIANT]: 'non_compliant',
    [VesselComplianceStatus.APPROACHING]:   'approaching',
    [VesselComplianceStatus.EXEMPT]:        'exempt',
};

const statusLabelKey: Record<VesselComplianceStatus, string> = {
    [VesselComplianceStatus.COMPLIANT]:     'status_compliant',
    [VesselComplianceStatus.PAYMENT_DUE]:   'status_payment_due',
    [VesselComplianceStatus.PROCESSING]:    'status_processing',
    [VesselComplianceStatus.NON_COMPLIANT]: 'status_non_compliant',
    [VesselComplianceStatus.APPROACHING]:   'status_approaching',
    [VesselComplianceStatus.EXEMPT]:        'status_exempt',
};

// ── Main component ───────────────────────────────────────────────────────────

export function LiveMapPanel() {
    const t = useTranslations('Overview');
    const { data: vessels } = useVessels();
    const [selected, setSelected] = React.useState<string | null>(null);
    const [filterOpen, setFilterOpen] = React.useState(false);
    const [activeFilters, setActiveFilters] = React.useState<Set<VesselComplianceStatus>>(new Set());
    const vessel = vessels.find((v) => v.id === selected);

    const filteredVessels = activeFilters.size === 0
        ? vessels
        : vessels.filter((v) => activeFilters.has(v.complianceStatus));

    function toggleFilter(status: VesselComplianceStatus) {
        setActiveFilters((prev) => {
            const next = new Set(prev);
            if (next.has(status)) next.delete(status);
            else next.add(status);
            return next;
        });
    }

    return (
        <div className="os-card overflow-hidden flex flex-col" style={{ minHeight: 'clamp(320px, 60vh, 480px)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-[var(--os-border)]">
                <div>
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('map_title')}</h3>
                    <p className="text-[10px] text-[var(--os-text-muted)]">{t('map_subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-[#00D97E] bg-[rgba(0,217,126,0.08)] px-2 py-1 rounded-lg border border-[#00D97E]/15">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00D97E] animate-pulse" />
                        {t('map_live_badge')}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--os-text-muted)] tabular-nums">
                        {filteredVessels.length} / {vessels.length}
                    </span>
                    <div className="relative">
                        <button
                            onClick={() => setFilterOpen((v) => !v)}
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
                                activeFilters.size > 0
                                    ? 'border-[#10B981]/40 bg-[rgba(16,185,129,0.08)] text-[#10B981]'
                                    : 'border-[var(--os-border)] text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)]'
                            }`}
                        >
                            <Filter className="w-4 h-4" />
                        </button>
                        {filterOpen && (
                            <div className="absolute right-0 top-full mt-2 w-48 rounded-xl p-2 z-50 shadow-xl"
                                style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
                            >
                                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] px-2 py-1">
                                    {t('map_filter_by_status')}
                                </p>
                                {Object.entries(dotColor).map(([status, color]) => (
                                    <button
                                        key={status}
                                        onClick={() => toggleFilter(status as VesselComplianceStatus)}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] transition-colors hover:bg-[var(--os-surface-2)]"
                                        style={{ color: activeFilters.has(status as VesselComplianceStatus) ? color : 'var(--os-text-muted)' }}
                                    >
                                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color, opacity: activeFilters.has(status as VesselComplianceStatus) ? 1 : 0.4 }} />
                                        <span>{t(statusLabelKey[status as VesselComplianceStatus])}</span>
                                        {activeFilters.has(status as VesselComplianceStatus) && (
                                            <span className="ml-auto text-[9px] font-bold">✓</span>
                                        )}
                                    </button>
                                ))}
                                {activeFilters.size > 0 && (
                                    <button
                                        onClick={() => setActiveFilters(new Set())}
                                        className="w-full text-center text-[10px] font-semibold text-[#10B981] py-1.5 mt-1 border-t border-[var(--os-border)] hover:opacity-80"
                                    >
                                        {t('map_clear_filters')}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row flex-1 overflow-hidden" style={{ minHeight: 'clamp(260px, 50vh, 400px)' }}>
                {/* Leaflet Map */}
                <LeafletMap
                    vessels={filteredVessels}
                    selectedId={selected}
                    onSelectVessel={(id) => setSelected(selected === id ? null : id)}
                    dotColor={dotColor}
                    t={t}
                />

                {/* Vessel detail panel */}
                {vessel && (
                    <VesselDetailPanel
                        vessel={vessel}
                        dotVariant={dotVariant}
                        statusLabelKey={statusLabelKey}
                        onClose={() => setSelected(null)}
                        t={t}
                    />
                )}
            </div>
        </div>
    );
}

// ── Vessel Detail Panel ──────────────────────────────────────────────────────

function VesselDetailPanel({
    vessel, dotVariant, statusLabelKey, onClose, t,
}: {
    vessel: SecureVessel;
    dotVariant: Record<VesselComplianceStatus, Parameters<typeof OsBadge>[0]['variant']>;
    statusLabelKey: Record<VesselComplianceStatus, string>;
    onClose: () => void;
    t: (key: string) => string;
}) {
    return (
        <div className="w-full sm:w-72 max-h-[50vh] sm:max-h-none border-t sm:border-t-0 sm:border-l border-[var(--os-border)] flex flex-col p-3 sm:p-4 gap-3 sm:gap-4 bg-[var(--os-surface)] overflow-y-auto">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm font-bold text-[var(--os-text-primary)]">{vessel.name}</p>
                    <p className="text-[10px] text-[var(--os-text-muted)]">IMO: {vessel.imoNumber} | {vessel.flagCode}</p>
                </div>
                <button onClick={onClose} className="text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] text-lg leading-none">&times;</button>
            </div>

            {(vessel.complianceStatus === VesselComplianceStatus.PAYMENT_DUE || vessel.complianceStatus === VesselComplianceStatus.NON_COMPLIANT) && (
                <div className="p-2.5 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                    <p className="text-[10px] font-bold text-[#EF4444] uppercase tracking-wide">{t('detail_payment_required')}</p>
                    <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">{t('detail_payment_desc')}</p>
                </div>
            )}

            <div className="flex flex-col gap-2 text-xs">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('detail_vessel_data')}</p>
                <DetailRow label={t('detail_type')} value={vessel.category.replace('_', ' ')} />
                <DetailRow label={t('detail_mmsi')} value={vessel.mmsi} mono />
                <DetailRow label={t('detail_speed')} value={`${vessel.position.speedKnots} kn`} />
                <DetailRow label="Heading" value={`${vessel.position.heading}°`} />
                <DetailRow label="Position" value={`${vessel.position.lat.toFixed(3)}° N, ${vessel.position.lng.toFixed(3)}° E`} mono />
                <div className="flex justify-between">
                    <span className="text-[var(--os-text-muted)]">{t('detail_status')}</span>
                    <OsBadge variant={dotVariant[vessel.complianceStatus]} label={t(statusLabelKey[vessel.complianceStatus])} size="sm" />
                </div>
            </div>

            <div className="border-t border-[var(--os-border)] pt-3">
                <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--os-text-muted)]">{t('detail_tax_liability')}</span>
                </div>
                <p className="text-xl font-bold text-[var(--os-text-primary)] tabular-nums">
                    ${vessel.taxLiabilityUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">
                    CO₂ est. {vessel.estimatedEmissionsTco2.toLocaleString()} tCO₂
                </p>
            </div>

            <div className="flex flex-col gap-2">
                <a
                    href={`/dashboard/vessels?id=${vessel.id}`}
                    className="w-full py-2 rounded-xl border border-[var(--os-border)] text-xs font-semibold text-[var(--os-text-secondary)] hover:border-[var(--os-border-strong)] hover:text-[var(--os-text-primary)] transition-colors text-center"
                >
                    {t('detail_hail_ship')}
                </a>
                <a
                    href={`/dashboard/invoices?vessel=${vessel.id}`}
                    className="w-full py-2 rounded-xl bg-[#00D97E] text-[#060D1A] text-xs font-bold hover:bg-[#00C070] transition-colors text-center shadow-[0_0_12px_rgba(0,217,126,0.2)]"
                >
                    {t('detail_generate_proforma')}
                </a>
            </div>
        </div>
    );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex justify-between">
            <span className="text-[var(--os-text-muted)]">{label}</span>
            <span className={`font-medium text-[var(--os-text-primary)] ${mono ? 'tabular-nums font-mono text-[11px]' : ''}`}>{value}</span>
        </div>
    );
}
