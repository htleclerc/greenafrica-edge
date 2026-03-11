'use client';

import * as React from 'react';
import { Search, Filter, Download, Plus, Ship } from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { mockSecureVessels, mockKpis } from '@/mock/datas/secureMock';
import { SecureVessel, VesselComplianceStatus, VesselCategory } from '@/types/secure';

const COMPLIANCE_LABEL: Record<VesselComplianceStatus, string> = {
    [VesselComplianceStatus.COMPLIANT]:     'COMPLIANT',
    [VesselComplianceStatus.PAYMENT_DUE]:   'PAYMENT DUE',
    [VesselComplianceStatus.PROCESSING]:    'PROCESSING',
    [VesselComplianceStatus.NON_COMPLIANT]: 'NON-COMPLIANT',
    [VesselComplianceStatus.APPROACHING]:   'APPROACHING',
    [VesselComplianceStatus.EXEMPT]:        'EXEMPT',
};

const COMPLIANCE_VARIANT: Record<VesselComplianceStatus, Parameters<typeof OsBadge>[0]['variant']> = {
    [VesselComplianceStatus.COMPLIANT]:     'compliant',
    [VesselComplianceStatus.PAYMENT_DUE]:   'payment_due',
    [VesselComplianceStatus.PROCESSING]:    'processing',
    [VesselComplianceStatus.NON_COMPLIANT]: 'non_compliant',
    [VesselComplianceStatus.APPROACHING]:   'approaching',
    [VesselComplianceStatus.EXEMPT]:        'exempt',
};

const CATEGORY_LABEL: Record<VesselCategory, string> = {
    [VesselCategory.CONTAINER]:     'Container Ship',
    [VesselCategory.CARGO]:         'General Cargo',
    [VesselCategory.TANKER]:        'Tanker',
    [VesselCategory.BULK_CARRIER]:  'Bulk Carrier',
    [VesselCategory.FERRY]:         'Ferry',
    [VesselCategory.NAVAL]:         'Naval',
    [VesselCategory.SCIENTIFIC]:    'Scientific',
};

type FilterStatus = 'ALL' | VesselComplianceStatus;

export function VesselsPage() {
    const [search, setSearch]       = React.useState('');
    const [filterStatus, setFilter] = React.useState<FilterStatus>('ALL');
    const [selected, setSelected]   = React.useState<string | null>(null);

    const filtered = mockSecureVessels.filter((v) => {
        const matchSearch = search === '' ||
            v.name.toLowerCase().includes(search.toLowerCase()) ||
            v.imoNumber.includes(search) ||
            v.mmsi.includes(search);
        const matchStatus = filterStatus === 'ALL' || v.complianceStatus === filterStatus;
        return matchSearch && matchStatus;
    });

    const vessel = mockSecureVessels.find((v) => v.id === selected);

    return (
        <div className="flex flex-col h-full">
            {/* Topbar KPIs */}
            <div className="border-b border-[var(--os-border)] bg-[var(--os-surface)] px-5 py-2 flex items-center gap-6">
                <KpiPill label="Daily Inflow" value={`+$42,500`} color="#00D97E" />
                <KpiPill label="Pending Review" value={String(mockKpis.pendingReviewCount)} color="#F59E0B" />
                <KpiPill label="Non-Compliant" value={String(mockKpis.nonCompliantCount)} color="#EF4444" />
                <KpiPill label="System Status" value="ONLINE" color="#00D97E" dot />
            </div>

            {/* Toolbar */}
            <div className="px-5 py-3 border-b border-[var(--os-border)] flex items-center gap-3 flex-wrap">
                {/* Search */}
                <div className="relative flex-1 min-w-48">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--os-text-muted)]" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by IMO, MMSI, Name, or Call Sign…"
                        className="w-full h-9 pl-9 pr-4 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/50 transition-colors"
                    />
                </div>

                {/* Status filter pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    {(['ALL', VesselComplianceStatus.PAYMENT_DUE, VesselComplianceStatus.COMPLIANT, VesselComplianceStatus.PROCESSING] as FilterStatus[]).map((s) => (
                        <button
                            key={s}
                            onClick={() => setFilter(s)}
                            className={`px-3 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                                filterStatus === s
                                    ? 'bg-[var(--os-surface-3)] text-[var(--os-text-primary)] border-[var(--os-border-strong)]'
                                    : 'text-[var(--os-text-muted)] border-[var(--os-border)] hover:border-[var(--os-border-strong)]'
                            }`}
                        >
                            {s === 'ALL' ? 'All' : COMPLIANCE_LABEL[s as VesselComplianceStatus]}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-[var(--os-text-muted)]">
                        Last updated: <span className="text-[var(--os-text-secondary)]">Just now</span>
                    </span>
                    <button className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors">
                        <Download className="w-3.5 h-3.5" />
                        Export CSV
                    </button>
                    <button className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[#00D97E] text-[#060D1A] text-xs font-bold hover:bg-[#00C070] transition-colors shadow-[0_0_10px_rgba(0,217,126,0.2)]">
                        <Plus className="w-3.5 h-3.5" />
                        Manual Entry
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                        <tr className="border-b border-[var(--os-border)]" style={{ backgroundColor: 'var(--os-surface-2)' }}>
                            <th className="w-10 px-4 py-3">
                                <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[#00D97E]" />
                            </th>
                            {['Vessel Details', 'Flag', 'Type / Size', 'Last Seen', 'Port Call', 'Status & Compliance', 'Actions'].map((h) => (
                                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] whitespace-nowrap">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-4 py-12 text-center text-[var(--os-text-muted)] text-xs">
                                    No vessels match your filters.
                                </td>
                            </tr>
                        ) : filtered.map((v) => (
                            <VesselRow
                                key={v.id}
                                vessel={v}
                                isSelected={selected === v.id}
                                onSelect={() => setSelected(selected === v.id ? null : v.id)}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footer pagination */}
            <div className="px-5 py-2.5 border-t border-[var(--os-border)] flex items-center justify-between text-xs text-[var(--os-text-muted)]">
                <span>Showing <strong className="text-[var(--os-text-primary)]">1-{filtered.length}</strong> of {mockSecureVessels.length} vessels</span>
                <div className="flex items-center gap-1">
                    {[1, 2, 3].map((p) => (
                        <button key={p} className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                            p === 1 ? 'bg-[#00D97E] text-[#060D1A]' : 'text-[var(--os-text-muted)] hover:bg-[var(--os-surface-2)]'
                        }`}>
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            {/* Vessel detail drawer (bottom) */}
            {vessel && (
                <VesselDetailDrawer vessel={vessel} onClose={() => setSelected(null)} />
            )}
        </div>
    );
}

// ── Sub components ────────────────────────────────────────────────────────────

function KpiPill({ label, value, color, dot }: { label: string; value: string; color: string; dot?: boolean }) {
    return (
        <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{label}</span>
            <span className="text-sm font-bold tabular-nums flex items-center gap-1.5" style={{ color }}>
                {dot && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />}
                {value}
            </span>
        </div>
    );
}

function VesselRow({ vessel: v, isSelected, onSelect }: { vessel: SecureVessel; isSelected: boolean; onSelect: () => void }) {
    const lastSeen = new Date(v.position.lastSeenUtc);
    const minsAgo  = Math.floor((Date.now() - lastSeen.getTime()) / 60000);
    const lastSeenLabel = minsAgo < 60
        ? `${lastSeen.getUTCHours().toString().padStart(2, '0')}:${lastSeen.getUTCMinutes().toString().padStart(2, '0')} UTC`
        : 'Yesterday';
    const lastSeenSub = minsAgo < 120 ? `In EEZ (${minsAgo}m ago)` : 'Departed';
    const isAlert = v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE || v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT;

    return (
        <tr
            onClick={onSelect}
            className={`border-b border-[var(--os-border)] last:border-0 cursor-pointer transition-colors ${
                isSelected ? 'bg-[var(--os-surface-2)]' : 'hover:bg-[rgba(255,255,255,0.02)]'
            } ${isAlert ? 'border-l-2 border-l-[#EF4444]' : ''}`}
        >
            <td className="px-4 py-4">
                <input type="checkbox" checked={isSelected} onChange={onSelect} onClick={(e) => e.stopPropagation()} className="w-3.5 h-3.5 rounded accent-[#00D97E]" />
            </td>
            <td className="px-4 py-4">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center justify-center flex-shrink-0">
                        <Ship className="w-4 h-4 text-[var(--os-text-muted)]" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-[var(--os-text-primary)]">{v.name}</p>
                        <p className="text-[10px] text-[var(--os-text-muted)]">IMO: {v.imoNumber}</p>
                    </div>
                </div>
            </td>
            <td className="px-4 py-4">
                <span className="text-sm font-semibold text-[var(--os-text-secondary)]">{v.flagCode}</span>
            </td>
            <td className="px-4 py-4">
                <p className="text-xs text-[var(--os-text-primary)]">{CATEGORY_LABEL[v.category]}</p>
                <p className="text-[10px] text-[var(--os-text-muted)]">{v.grossTonnageDwt.toLocaleString()} DWT</p>
            </td>
            <td className="px-4 py-4">
                <p className="text-xs font-medium text-[var(--os-text-primary)]">{lastSeenLabel}</p>
                <p className={`text-[10px] ${isAlert ? 'text-[#EF4444]' : 'text-[var(--os-text-muted)]'}`}>{lastSeenSub}</p>
            </td>
            <td className="px-4 py-4">
                <span className="text-xs px-2 py-0.5 rounded-lg bg-[var(--os-surface-3)] border border-[var(--os-border)] text-[var(--os-text-secondary)] font-medium">
                    {v.portCall}
                </span>
            </td>
            <td className="px-4 py-4">
                <OsBadge variant={COMPLIANCE_VARIANT[v.complianceStatus]} label={COMPLIANCE_LABEL[v.complianceStatus]} />
                {!v.proFormaGenerated && v.complianceStatus !== VesselComplianceStatus.COMPLIANT && (
                    <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">No Pro-forma generated</p>
                )}
                {v.complianceStatus === VesselComplianceStatus.COMPLIANT && (
                    <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">Offset Credits Applied</p>
                )}
            </td>
            <td className="px-4 py-4">
                <a
                    href={`/dashboard/invoices?vessel=${v.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] font-semibold text-[#38BDF8] hover:underline whitespace-nowrap"
                >
                    Pro-forma →
                </a>
            </td>
        </tr>
    );
}

function VesselDetailDrawer({ vessel: v, onClose }: { vessel: SecureVessel; onClose: () => void }) {
    return (
        <div className="border-t border-[var(--os-border)] bg-[var(--os-surface-2)] px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-6 animate-in slide-in-from-bottom-2 duration-200">
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">Identity</p>
                <p className="text-sm font-bold text-[var(--os-text-primary)]">{v.name}</p>
                <p className="text-xs text-[var(--os-text-muted)]">IMO {v.imoNumber} · MMSI {v.mmsi}</p>
                <p className="text-xs text-[var(--os-text-muted)]">Call Sign: {v.callSign} · Flag: {v.flagCode}</p>
            </div>
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">Position</p>
                <p className="text-xs text-[var(--os-text-primary)]">{v.position.lat.toFixed(4)}° N, {v.position.lng.toFixed(4)}° E</p>
                <p className="text-xs text-[var(--os-text-muted)]">Heading {v.position.heading}° · {v.position.speedKnots} kn</p>
                <p className="text-xs text-[var(--os-text-muted)]">Port: {v.portCall}</p>
            </div>
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">Emissions & Tax</p>
                <p className="text-xl font-bold text-[#EF4444] tabular-nums">${v.taxLiabilityUsd.toLocaleString()}</p>
                <p className="text-xs text-[var(--os-text-muted)]">{v.estimatedEmissionsTco2} tCO₂ estimated</p>
                <p className="text-xs text-[var(--os-text-muted)]">DWT: {v.grossTonnageDwt.toLocaleString()}</p>
            </div>
            <div className="flex flex-col gap-2 justify-center">
                <a
                    href={`/dashboard/invoices?vessel=${v.id}`}
                    className="w-full py-2 rounded-xl bg-[#00D97E] text-[#060D1A] text-xs font-bold text-center hover:bg-[#00C070] transition-colors"
                >
                    Generate Pro-forma →
                </a>
                <button
                    onClick={onClose}
                    className="w-full py-2 rounded-xl border border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors"
                >
                    Close
                </button>
            </div>
        </div>
    );
}
