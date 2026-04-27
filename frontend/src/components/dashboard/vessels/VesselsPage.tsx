'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Search, Filter, Download, Plus, Ship, CheckCircle2, Clock, FileText, AlertTriangle, Radio, Shield, CreditCard, Eye } from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { useVessels } from '@/hooks/useVessels';
import { useKpis } from '@/hooks/useKpis';
import { useTransactions } from '@/hooks/useTransactions';
import { useRole } from '@/lib/RoleContext';
import { SecureVessel, VesselComplianceStatus, VesselCategory, UserRole, Transaction, TransactionStatus } from '@/types/secure';
import { transactionVariant } from '@/lib/badgeUtils';

// ── Status → Action mapping ──────────────────────────────────────────────────
// Each compliance status maps to a context-appropriate primary action.
// Pro-forma generation is only the right CTA when payment is actually due.

interface VesselAction {
    labelKey: string;
    href: (v: SecureVessel) => string;
    icon: React.ReactNode;
    color: string;
}

// Staff (PORT_OFFICER / FINANCE_ADMIN / SUPERADMIN / MANAGER) actions —
// authority-side language: generate, issue, hail.
const STAFF_ACTION: Record<VesselComplianceStatus, VesselAction> = {
    [VesselComplianceStatus.COMPLIANT]: {
        labelKey: 'action_view_receipt',
        href: (v) => `/dashboard/invoices?vessel=${v.imoNumber}`,
        icon: <CheckCircle2 className="w-3 h-3" />,
        color: '#22C55E',
    },
    [VesselComplianceStatus.PROCESSING]: {
        labelKey: 'action_track_payment',
        href: (v) => `/dashboard/invoices?vessel=${v.imoNumber}`,
        icon: <Clock className="w-3 h-3" />,
        color: '#F59E0B',
    },
    [VesselComplianceStatus.PAYMENT_DUE]: {
        labelKey: 'action_generate_proforma',
        href: (v) => `/dashboard/invoices?vessel=${v.imoNumber}`,
        icon: <FileText className="w-3 h-3" />,
        color: '#EF4444',
    },
    [VesselComplianceStatus.NON_COMPLIANT]: {
        labelKey: 'action_issue_notice',
        href: (v) => `/dashboard/disputes?new=true&vessel=${v.imoNumber}`,
        icon: <AlertTriangle className="w-3 h-3" />,
        color: '#EF4444',
    },
    [VesselComplianceStatus.APPROACHING]: {
        labelKey: 'action_hail_vessel',
        href: (v) => `/dashboard/simulator?imo=${v.imoNumber}`,
        icon: <Radio className="w-3 h-3" />,
        color: '#38BDF8',
    },
    [VesselComplianceStatus.EXEMPT]: {
        labelKey: 'action_view_exemption',
        href: () => `/admin/tax-settings#exemptions`,
        icon: <Shield className="w-3 h-3" />,
        color: '#0EA5E9',
    },
};

// Armateur (SHIPPING_AGENT / SHIPOWNER) actions — debtor-side language: pay,
// view. The system mints proformas; the armateur settles them. Same hrefs land
// on /dashboard/invoices?vessel=… where they can preview + pay the document.
const ARMATEUR_ACTION: Record<VesselComplianceStatus, VesselAction> = {
    ...STAFF_ACTION,
    [VesselComplianceStatus.PAYMENT_DUE]: {
        labelKey: 'action_pay_proforma',
        href: (v) => `/dashboard/invoices?vessel=${v.imoNumber}`,
        icon: <CreditCard className="w-3 h-3" />,
        color: '#EF4444',
    },
    [VesselComplianceStatus.NON_COMPLIANT]: {
        labelKey: 'action_pay_proforma',
        href: (v) => `/dashboard/invoices?vessel=${v.imoNumber}`,
        icon: <CreditCard className="w-3 h-3" />,
        color: '#EF4444',
    },
    [VesselComplianceStatus.APPROACHING]: {
        labelKey: 'action_view_proforma',
        href: (v) => `/dashboard/invoices?vessel=${v.imoNumber}`,
        icon: <Eye className="w-3 h-3" />,
        color: '#38BDF8',
    },
};

function isArmateurRole(role: UserRole): boolean {
    return role === UserRole.SHIPPING_AGENT;
}

const COMPLIANCE_VARIANT: Record<VesselComplianceStatus, Parameters<typeof OsBadge>[0]['variant']> = {
    [VesselComplianceStatus.COMPLIANT]:     'compliant',
    [VesselComplianceStatus.PAYMENT_DUE]:   'payment_due',
    [VesselComplianceStatus.PROCESSING]:    'processing',
    [VesselComplianceStatus.NON_COMPLIANT]: 'non_compliant',
    [VesselComplianceStatus.APPROACHING]:   'approaching',
    [VesselComplianceStatus.EXEMPT]:        'exempt',
};

type FilterStatus = 'ALL' | VesselComplianceStatus;

export function VesselsPage() {
    const t = useTranslations('VesselsPage');
    const { role } = useRole();
    const { data: vessels } = useVessels();
    const { data: kpis } = useKpis();
    const { data: transactions } = useTransactions();
    const [search, setSearch]       = React.useState('');
    const [filterStatus, setFilter] = React.useState<FilterStatus>('ALL');
    const [selected, setSelected]   = React.useState<string | null>(null);

    const isArmateur = isArmateurRole(role);
    const actionMap  = isArmateur ? ARMATEUR_ACTION : STAFF_ACTION;

    const COMPLIANCE_LABEL: Record<VesselComplianceStatus, string> = {
        [VesselComplianceStatus.COMPLIANT]:     t('status_compliant'),
        [VesselComplianceStatus.PAYMENT_DUE]:   t('status_payment_due'),
        [VesselComplianceStatus.PROCESSING]:    t('status_processing'),
        [VesselComplianceStatus.NON_COMPLIANT]: t('status_non_compliant'),
        [VesselComplianceStatus.APPROACHING]:   t('status_approaching'),
        [VesselComplianceStatus.EXEMPT]:        t('status_exempt'),
    };

    const CATEGORY_LABEL: Record<VesselCategory, string> = {
        [VesselCategory.CONTAINER]:     t('cat_container'),
        [VesselCategory.CARGO]:         t('cat_cargo'),
        [VesselCategory.TANKER]:        t('cat_tanker'),
        [VesselCategory.BULK_CARRIER]:  t('cat_bulk_carrier'),
        [VesselCategory.FERRY]:         t('cat_ferry'),
        [VesselCategory.NAVAL]:         t('cat_naval'),
        [VesselCategory.SCIENTIFIC]:    t('cat_scientific'),
    };

    const filtered = vessels.filter((v) => {
        const matchSearch = search === '' ||
            v.name.toLowerCase().includes(search.toLowerCase()) ||
            v.imoNumber.includes(search) ||
            v.mmsi.includes(search);
        const matchStatus = filterStatus === 'ALL' || v.complianceStatus === filterStatus;
        return matchSearch && matchStatus;
    });

    const vessel = vessels.find((v) => v.id === selected);

    return (
        <div className="flex flex-col h-full">
            {/* Topbar KPIs */}
            <div className="border-b border-[var(--os-border)] bg-[var(--os-surface)] px-3 sm:px-5 py-2 flex items-center gap-3 sm:gap-6 overflow-x-auto">
                <KpiPill label={t('kpi_daily_inflow')} value={`+$42,500`} color="#00D97E" />
                <KpiPill label={t('kpi_pending_review')} value={String(kpis.pendingReviewCount)} color="#F59E0B" />
                <KpiPill label={t('kpi_non_compliant')} value={String(kpis.nonCompliantCount)} color="#EF4444" />
                <KpiPill label={t('kpi_system_status')} value={t('kpi_online')} color="#00D97E" dot />
            </div>

            {/* Toolbar */}
            <div className="px-3 sm:px-5 py-3 border-b border-[var(--os-border)] flex items-center gap-3 flex-wrap">
                {/* Search */}
                <div className="relative flex-1 min-w-0 sm:min-w-48">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--os-text-muted)]" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('search_placeholder')}
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
                            {s === 'ALL' ? t('filter_all') : COMPLIANCE_LABEL[s as VesselComplianceStatus]}
                        </button>
                    ))}
                </div>

                <div className="hidden sm:flex items-center gap-2 ml-auto">
                    <span className="text-xs text-[var(--os-text-muted)]">
                        {t('last_updated')}: <span className="text-[var(--os-text-secondary)]">{t('just_now')}</span>
                    </span>
                    <button className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors">
                        <Download className="w-3.5 h-3.5" />
                        {t('export_csv')}
                    </button>
                    <button className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[#00D97E] text-[#060D1A] text-xs font-bold hover:bg-[#00C070] transition-colors shadow-[0_0_10px_rgba(0,217,126,0.2)]">
                        <Plus className="w-3.5 h-3.5" />
                        {t('manual_entry')}
                    </button>
                </div>
            </div>

            {/* Table (desktop) */}
            <div className="flex-1 overflow-auto hidden md:block">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                        <tr className="border-b border-[var(--os-border)]" style={{ backgroundColor: 'var(--os-surface-2)' }}>
                            <th className="w-10 px-4 py-3">
                                <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[#00D97E]" />
                            </th>
                            {[t('col_vessel_details'), t('col_flag'), t('col_type_size'), t('col_last_seen'), t('col_port_call'), t('col_status_compliance'), t('col_actions')].map((h) => (
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
                                    {t('no_vessels_match')}
                                </td>
                            </tr>
                        ) : filtered.map((v) => (
                            <VesselRow
                                key={v.id}
                                vessel={v}
                                isSelected={selected === v.id}
                                onSelect={() => setSelected(selected === v.id ? null : v.id)}
                                complianceLabel={COMPLIANCE_LABEL}
                                categoryLabel={CATEGORY_LABEL}
                                actionMap={actionMap}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Card list (mobile) */}
            <div className="flex-1 overflow-auto md:hidden px-3 py-2 space-y-2">
                {filtered.length === 0 ? (
                    <div className="px-4 py-12 text-center text-[var(--os-text-muted)] text-xs">
                        {t('no_vessels_match')}
                    </div>
                ) : filtered.map((v) => (
                    <VesselCard
                        key={v.id}
                        vessel={v}
                        isSelected={selected === v.id}
                        onSelect={() => setSelected(selected === v.id ? null : v.id)}
                        complianceLabel={COMPLIANCE_LABEL}
                        categoryLabel={CATEGORY_LABEL}
                    />
                ))}
            </div>

            {/* Footer pagination */}
            <div className="px-3 sm:px-5 py-2.5 border-t border-[var(--os-border)] flex items-center justify-between text-xs text-[var(--os-text-muted)]">
                <span>{t('showing_vessels', { from: 1, to: filtered.length, total: vessels.length })}</span>
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
                <VesselDetailDrawer
                    vessel={vessel}
                    onClose={() => setSelected(null)}
                    isArmateur={isArmateur}
                    documents={transactions.filter((tx) => tx.vesselId === vessel.id)}
                />
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

function VesselRow({ vessel: v, isSelected, onSelect, complianceLabel, categoryLabel, actionMap }: {
    vessel: SecureVessel;
    isSelected: boolean;
    onSelect: () => void;
    complianceLabel: Record<VesselComplianceStatus, string>;
    categoryLabel: Record<VesselCategory, string>;
    actionMap: Record<VesselComplianceStatus, VesselAction>;
}) {
    const t = useTranslations('VesselsPage');
    const lastSeen = new Date(v.position.lastSeenUtc);
    const minsAgo  = Math.floor((Date.now() - lastSeen.getTime()) / 60000);
    const lastSeenLabel = minsAgo < 60
        ? `${lastSeen.getUTCHours().toString().padStart(2, '0')}:${lastSeen.getUTCMinutes().toString().padStart(2, '0')} UTC`
        : t('yesterday');
    const lastSeenSub = minsAgo < 120 ? t('in_eez_ago', { minutes: minsAgo }) : t('departed');
    const isAlert = v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE || v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT;
    const action = actionMap[v.complianceStatus];

    return (
        <tr
            onClick={onSelect}
            className={`border-b border-[var(--os-border)] last:border-0 cursor-pointer transition-colors ${
                isSelected ? 'bg-[var(--os-surface-2)]' : 'hover:bg-[rgba(255,255,255,0.02)]'
            } ${isAlert ? 'border-l-2 border-l-[#EF4444]' : ''}`}
        >
            <td className="px-2 sm:px-4 py-3 sm:py-4">
                <input type="checkbox" checked={isSelected} onChange={onSelect} onClick={(e) => e.stopPropagation()} className="w-3.5 h-3.5 rounded accent-[#00D97E]" />
            </td>
            <td className="px-2 sm:px-4 py-3 sm:py-4">
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
            <td className="px-2 sm:px-4 py-3 sm:py-4">
                <span className="text-sm font-semibold text-[var(--os-text-secondary)]">{v.flagCode}</span>
            </td>
            <td className="px-2 sm:px-4 py-3 sm:py-4">
                <p className="text-xs text-[var(--os-text-primary)]">{categoryLabel[v.category]}</p>
                <p className="text-[10px] text-[var(--os-text-muted)]">{v.grossTonnageDwt.toLocaleString()} DWT</p>
            </td>
            <td className="px-2 sm:px-4 py-3 sm:py-4">
                <p className="text-xs font-medium text-[var(--os-text-primary)]">{lastSeenLabel}</p>
                <p className={`text-[10px] ${isAlert ? 'text-[#EF4444]' : 'text-[var(--os-text-muted)]'}`}>{lastSeenSub}</p>
            </td>
            <td className="px-2 sm:px-4 py-3 sm:py-4">
                <span className="text-xs px-2 py-0.5 rounded-lg bg-[var(--os-surface-3)] border border-[var(--os-border)] text-[var(--os-text-secondary)] font-medium">
                    {v.portCall}
                </span>
            </td>
            <td className="px-2 sm:px-4 py-3 sm:py-4">
                <OsBadge variant={COMPLIANCE_VARIANT[v.complianceStatus]} label={complianceLabel[v.complianceStatus]} />
                {!v.proFormaGenerated && v.complianceStatus !== VesselComplianceStatus.COMPLIANT && (
                    <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">{t('no_proforma_generated')}</p>
                )}
                {v.complianceStatus === VesselComplianceStatus.COMPLIANT && (
                    <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">{t('offset_credits_applied')}</p>
                )}
            </td>
            <td className="px-2 sm:px-4 py-3 sm:py-4">
                <a
                    href={action.href(v)}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold hover:underline whitespace-nowrap transition-colors"
                    style={{ color: action.color }}
                >
                    {action.icon}
                    {t(action.labelKey)}
                </a>
            </td>
        </tr>
    );
}

function VesselCard({ vessel: v, isSelected, onSelect, complianceLabel, categoryLabel }: {
    vessel: SecureVessel;
    isSelected: boolean;
    onSelect: () => void;
    complianceLabel: Record<VesselComplianceStatus, string>;
    categoryLabel: Record<VesselCategory, string>;
}) {
    const isAlert = v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE || v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT;
    return (
        <button
            onClick={onSelect}
            className={`w-full text-left p-3 rounded-xl border transition-colors ${
                isSelected ? 'bg-[var(--os-surface-2)] border-[var(--os-border-strong)]' : 'border-[var(--os-border)] hover:bg-[rgba(255,255,255,0.02)]'
            } ${isAlert ? 'border-l-2 border-l-[#EF4444]' : ''}`}
        >
            <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center justify-center flex-shrink-0">
                    <Ship className="w-4 h-4 text-[var(--os-text-muted)]" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--os-text-primary)] truncate">{v.name}</p>
                    <p className="text-[10px] text-[var(--os-text-muted)]">IMO: {v.imoNumber} · {v.flagCode}</p>
                </div>
                <OsBadge variant={COMPLIANCE_VARIANT[v.complianceStatus]} label={complianceLabel[v.complianceStatus]} />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--os-text-muted)]">
                <span>{categoryLabel[v.category]} · {v.grossTonnageDwt.toLocaleString()} DWT</span>
                <span className="font-medium">{v.portCall}</span>
            </div>
        </button>
    );
}

function VesselDetailDrawer({ vessel: v, onClose, isArmateur, documents }: {
    vessel: SecureVessel;
    onClose: () => void;
    isArmateur: boolean;
    documents: Transaction[];
}) {
    const t = useTranslations('VesselsPage');
    return (
        <div className="border-t border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 sm:px-5 py-4 flex flex-col gap-4 animate-in slide-in-from-bottom-2 duration-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">{t('drawer_identity')}</p>
                    <p className="text-sm font-bold text-[var(--os-text-primary)]">{v.name}</p>
                    <p className="text-xs text-[var(--os-text-muted)]">IMO {v.imoNumber} · MMSI {v.mmsi}</p>
                    <p className="text-xs text-[var(--os-text-muted)]">{t('drawer_call_sign')}: {v.callSign} · {t('drawer_flag')}: {v.flagCode}</p>
                </div>
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">{t('drawer_position')}</p>
                    <p className="text-xs text-[var(--os-text-primary)]">{v.position.lat.toFixed(4)}° N, {v.position.lng.toFixed(4)}° E</p>
                    <p className="text-xs text-[var(--os-text-muted)]">{t('drawer_heading')} {v.position.heading}° · {v.position.speedKnots} kn</p>
                    <p className="text-xs text-[var(--os-text-muted)]">{t('drawer_port')}: {v.portCall}</p>
                </div>
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">{t('drawer_emissions_tax')}</p>
                    <p className="text-xl font-bold text-[#EF4444] tabular-nums">${v.taxLiabilityUsd.toLocaleString()}</p>
                    <p className="text-xs text-[var(--os-text-muted)]">{t('drawer_estimated_emissions', { value: v.estimatedEmissionsTco2 })}</p>
                    <p className="text-xs text-[var(--os-text-muted)]">DWT: {v.grossTonnageDwt.toLocaleString()}</p>
                </div>
                <div className="flex flex-col gap-2 justify-center">
                    {!isArmateur && (
                        <a
                            href={`/dashboard/invoices?vessel=${v.imoNumber}`}
                            className="w-full py-2 rounded-xl bg-[#00D97E] text-[#060D1A] text-xs font-bold text-center hover:bg-[#00C070] transition-colors"
                        >
                            {t('generate_proforma')}
                        </a>
                    )}
                    <button
                        onClick={onClose}
                        className="w-full py-2 rounded-xl border border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors"
                    >
                        {t('close')}
                    </button>
                </div>
            </div>

            {/* Documents (proformas + invoices) — armateur view only */}
            {isArmateur && documents.length > 0 && (
                <DrawerDocuments documents={documents} vesselImo={v.imoNumber} />
            )}
        </div>
    );
}

function DrawerDocuments({ documents, vesselImo }: { documents: Transaction[]; vesselImo: string }) {
    const t = useTranslations('VesselsPage');

    const STATUS_LABEL: Record<TransactionStatus, string> = {
        [TransactionStatus.PAID]:     t('status_compliant'),
        [TransactionStatus.PENDING]:  t('status_payment_due'),
        [TransactionStatus.OVERDUE]:  t('status_non_compliant'),
        [TransactionStatus.EXEMPT]:   t('status_exempt'),
        [TransactionStatus.DISPUTED]: t('status_processing'),
    };

    const sorted = [...documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return (
        <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">{t('drawer_documents')}</p>
            <div className="rounded-xl border border-[var(--os-border)] overflow-hidden">
                <table className="w-full text-xs">
                    <thead className="bg-[var(--os-surface-3)]">
                        <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--os-text-muted)]">
                            <th className="px-3 py-2 font-bold">{t('doc_reference')}</th>
                            <th className="px-3 py-2 font-bold">{t('doc_issued')}</th>
                            <th className="px-3 py-2 font-bold">{t('doc_status')}</th>
                            <th className="px-3 py-2 font-bold text-right">{t('doc_amount')}</th>
                            <th className="px-3 py-2 font-bold text-right">{t('col_actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((tx) => {
                            const isPaid    = tx.status === TransactionStatus.PAID;
                            const isPayable = tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.OVERDUE;
                            const href      = `/dashboard/invoices?vessel=${vesselImo}&txn=${tx.id}`;
                            return (
                                <tr key={tx.id} className="border-t border-[var(--os-border)]">
                                    <td className="px-3 py-2.5">
                                        <p className="font-mono font-semibold text-[var(--os-text-primary)]">{tx.ref}</p>
                                        <p className="text-[10px] text-[var(--os-text-muted)]">{tx.transactionType.replace('_', ' ')}</p>
                                    </td>
                                    <td className="px-3 py-2.5 text-[var(--os-text-secondary)]">
                                        {new Date(tx.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <OsBadge variant={transactionVariant(tx.status)} label={STATUS_LABEL[tx.status]} />
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-bold text-[var(--os-text-primary)] tabular-nums">
                                        ${tx.taxAmountUsd.toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2.5 text-right">
                                        {isPayable && (
                                            <a href={href} className="inline-flex items-center gap-1 text-[11px] font-bold text-[#EF4444] hover:underline">
                                                <CreditCard className="w-3 h-3" />
                                                {t('doc_pay')}
                                            </a>
                                        )}
                                        {isPaid && (
                                            <a href={href} className="inline-flex items-center gap-1 text-[11px] font-bold text-[#22C55E] hover:underline">
                                                <Eye className="w-3 h-3" />
                                                {t('doc_view_invoice')}
                                            </a>
                                        )}
                                        {!isPayable && !isPaid && (
                                            <a href={href} className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--os-text-secondary)] hover:underline">
                                                <Eye className="w-3 h-3" />
                                                {t('doc_view')}
                                            </a>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
