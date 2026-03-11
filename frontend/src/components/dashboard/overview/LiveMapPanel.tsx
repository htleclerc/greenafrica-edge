'use client';

import * as React from 'react';
import { Layers, Filter, ZoomIn, ZoomOut, RefreshCw } from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { mockSecureVessels } from '@/mock/datas/secureMock';
import { VesselComplianceStatus } from '@/types/secure';

// Simple SVG map placeholder — replaced by Mapbox GL in Sprint 2
export function LiveMapPanel() {
    const [selected, setSelected] = React.useState<string | null>(null);
    const vessel = mockSecureVessels.find((v) => v.id === selected);

    // Normalize geo coords → SVG space (Gulf of Aden bounding box)
    const minLat = 10, maxLat = 13.5, minLng = 43, maxLng = 48;
    const W = 100, H = 100;
    function toSvg(lat: number, lng: number) {
        const x = ((lng - minLng) / (maxLng - minLng)) * W;
        const y = H - ((lat - minLat) / (maxLat - minLat)) * H;
        return { x, y };
    }

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

    const statusLabel: Record<VesselComplianceStatus, string> = {
        [VesselComplianceStatus.COMPLIANT]:     'Compliant / Paid',
        [VesselComplianceStatus.PAYMENT_DUE]:   'Payment Due',
        [VesselComplianceStatus.PROCESSING]:    'Processing',
        [VesselComplianceStatus.NON_COMPLIANT]: 'Non-Compliant',
        [VesselComplianceStatus.APPROACHING]:   'Approaching / Pending',
        [VesselComplianceStatus.EXEMPT]:        'Exempt',
    };

    return (
        <div className="os-card overflow-hidden flex flex-col" style={{ minHeight: 420 }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--os-border)]">
                <div>
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">Live Maritime AIS Data</h3>
                    <p className="text-[10px] text-[var(--os-text-muted)]">Real-time vessel tracking & emission footprints</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-[#00D97E] bg-[rgba(0,217,126,0.08)] px-2 py-1 rounded-lg border border-[#00D97E]/15">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00D97E] animate-pulse" />
                        LIVE
                    </span>
                    <button className="w-8 h-8 rounded-lg border border-[var(--os-border)] flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors">
                        <Layers className="w-4 h-4" />
                    </button>
                    <button className="w-8 h-8 rounded-lg border border-[var(--os-border)] flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors">
                        <Filter className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* SVG Map */}
                <div className="flex-1 relative bg-[#060D1A] overflow-hidden">
                    {/* Grid lines */}
                    <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <line key={`v${i}`} x1={`${(i / 8) * 100}%`} y1="0" x2={`${(i / 8) * 100}%`} y2="100%" stroke="#38BDF8" strokeWidth="0.5" />
                        ))}
                        {Array.from({ length: 6 }).map((_, i) => (
                            <line key={`h${i}`} x1="0" y1={`${(i / 6) * 100}%`} x2="100%" y2={`${(i / 6) * 100}%`} stroke="#38BDF8" strokeWidth="0.5" />
                        ))}
                    </svg>

                    {/* EEZ boundary suggestion */}
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        {/* Rough Gulf of Aden EEZ poly */}
                        <polygon
                            points="5,60 25,45 55,48 80,30 95,35 95,85 5,85"
                            fill="rgba(56,189,248,0.04)"
                            stroke="#38BDF8"
                            strokeWidth="0.4"
                            strokeDasharray="2,1"
                        />
                        {/* Berbera port marker */}
                        <circle cx="30" cy="73" r="2" fill="#F59E0B" opacity="0.8" />
                        <text x="32" y="72" fontSize="3" fill="#F59E0B" opacity="0.7">Berbera</text>
                    </svg>

                    {/* Vessel dots */}
                    {mockSecureVessels.map((v) => {
                        const { x, y } = toSvg(v.position.lat, v.position.lng);
                        const color = dotColor[v.complianceStatus];
                        const pct = { x: `${x}%`, y: `${y}%` };
                        const isSelected = selected === v.id;
                        return (
                            <button
                                key={v.id}
                                onClick={() => setSelected(selected === v.id ? null : v.id)}
                                className="absolute -translate-x-1/2 -translate-y-1/2 group"
                                style={{ left: pct.x, top: pct.y }}
                                title={v.name}
                            >
                                <div
                                    className="w-3 h-3 rounded-full border-2 border-[var(--os-bg)] transition-transform group-hover:scale-150"
                                    style={{
                                        backgroundColor: color,
                                        boxShadow: isSelected ? `0 0 10px ${color}` : `0 0 4px ${color}60`,
                                        transform: isSelected ? 'scale(1.6)' : undefined,
                                    }}
                                />
                            </button>
                        );
                    })}

                    {/* Zoom controls */}
                    <div className="absolute top-3 right-3 flex flex-col gap-1">
                        <button className="w-7 h-7 rounded-lg bg-[var(--os-surface)] border border-[var(--os-border)] flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors">
                            <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                        <button className="w-7 h-7 rounded-lg bg-[var(--os-surface)] border border-[var(--os-border)] flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors">
                            <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <button className="w-7 h-7 rounded-lg bg-[var(--os-surface)] border border-[var(--os-border)] flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors">
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {/* Legend */}
                    <div className="absolute bottom-3 left-3 bg-[var(--os-surface)] border border-[var(--os-border)] rounded-xl p-3 text-[10px]">
                        <p className="font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">Vessel Status</p>
                        {[
                            { label: 'Compliant / Paid',      color: '#22C55E' },
                            { label: 'Approaching / Pending', color: '#F59E0B' },
                            { label: 'Non-Compliant',          color: '#EF4444' },
                        ].map(({ label, color }) => (
                            <div key={label} className="flex items-center gap-2 mb-1 last:mb-0">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }} />
                                <span className="text-[var(--os-text-secondary)]">{label}</span>
                            </div>
                        ))}
                        <div className="flex items-center gap-2 mt-1 border-t border-[var(--os-border)] pt-1">
                            <span className="w-5 border-t-2 border-dashed border-[#38BDF8] flex-shrink-0" />
                            <span className="text-[var(--os-text-secondary)]">EEZ Boundary</span>
                        </div>
                    </div>
                </div>

                {/* Vessel detail panel (shows when a vessel is clicked) */}
                {vessel && (
                    <div className="w-64 border-l border-[var(--os-border)] flex flex-col p-4 gap-4 bg-[var(--os-surface)]">
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-sm font-bold text-[var(--os-text-primary)]">{vessel.name}</p>
                                <p className="text-[10px] text-[var(--os-text-muted)]">IMO: {vessel.imoNumber} | 🏴 {vessel.flagCode}</p>
                            </div>
                            <button onClick={() => setSelected(null)} className="text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] text-lg leading-none">×</button>
                        </div>

                        {vessel.complianceStatus === VesselComplianceStatus.PAYMENT_DUE || vessel.complianceStatus === VesselComplianceStatus.NON_COMPLIANT ? (
                            <div className="p-2.5 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                                <p className="text-[10px] font-bold text-[#EF4444] uppercase tracking-wide">Payment Required</p>
                                <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">
                                    Vessel entered EEZ. No pro-forma generated.
                                </p>
                            </div>
                        ) : null}

                        <div className="flex flex-col gap-2 text-xs">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">Vessel Data</p>
                            <div className="flex justify-between">
                                <span className="text-[var(--os-text-muted)]">Type</span>
                                <span className="font-medium text-[var(--os-text-primary)]">{vessel.category.replace('_', ' ')}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-[var(--os-text-muted)]">MMSI</span>
                                <span className="font-medium text-[var(--os-text-primary)] tabular-nums">{vessel.mmsi}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-[var(--os-text-muted)]">Speed</span>
                                <span className="font-medium text-[var(--os-text-primary)]">{vessel.position.speedKnots} kn</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-[var(--os-text-muted)]">Status</span>
                                <OsBadge variant={dotVariant[vessel.complianceStatus]} label={statusLabel[vessel.complianceStatus]} size="sm" />
                            </div>
                        </div>

                        <div className="border-t border-[var(--os-border)] pt-3">
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-[var(--os-text-muted)]">Tax Liability (Est.):</span>
                            </div>
                            <p className="text-xl font-bold text-[var(--os-text-primary)] tabular-nums">
                                ${vessel.taxLiabilityUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                        </div>

                        <div className="flex flex-col gap-2">
                            <a
                                href={`/dashboard/vessels?id=${vessel.id}`}
                                className="w-full py-2 rounded-xl border border-[var(--os-border)] text-xs font-semibold text-[var(--os-text-secondary)] hover:border-[var(--os-border-strong)] hover:text-[var(--os-text-primary)] transition-colors text-center"
                            >
                                Hail Ship
                            </a>
                            <a
                                href={`/dashboard/invoices?vessel=${vessel.id}`}
                                className="w-full py-2 rounded-xl bg-[#00D97E] text-[#060D1A] text-xs font-bold hover:bg-[#00C070] transition-colors text-center shadow-[0_0_12px_rgba(0,217,126,0.2)]"
                            >
                                Generate Pro-forma →
                            </a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
