'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Search, Download, Ship, AlertTriangle, FileText, Scale, CheckCircle, Clock } from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { useVessels } from '@/hooks/useVessels';
import { useTransactions } from '@/hooks/useTransactions';
import { useRole } from '@/lib/RoleContext';
import {
    SecureVessel,
    VesselComplianceStatus,
    VesselCategory,
    Transaction,
    TransactionStatus,
    UserRole,
    isShipRole,
} from '@/types/secure';
import { transactionVariant } from '@/lib/badgeUtils';
import type { BadgeVariant } from '@/lib/badgeUtils';

const COMPLIANCE_VARIANT: Record<VesselComplianceStatus, BadgeVariant> = {
    [VesselComplianceStatus.COMPLIANT]:     'compliant',
    [VesselComplianceStatus.PAYMENT_DUE]:   'payment_due',
    [VesselComplianceStatus.PROCESSING]:    'processing',
    [VesselComplianceStatus.NON_COMPLIANT]: 'non_compliant',
    [VesselComplianceStatus.APPROACHING]:   'approaching',
    [VesselComplianceStatus.EXEMPT]:        'exempt',
};

export function MyFleetPage() {
    const t = useTranslations('MyFleet');
    const { role } = useRole();
    const { data: vessels } = useVessels();
    const { data: transactions } = useTransactions();
    const [search, setSearch] = React.useState('');

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

    const STATUS_LABEL: Record<TransactionStatus, string> = {
        [TransactionStatus.PAID]:     t('tx_paid'),
        [TransactionStatus.PENDING]:  t('tx_pending'),
        [TransactionStatus.OVERDUE]:  t('tx_overdue'),
        [TransactionStatus.EXEMPT]:   t('tx_exempt'),
        [TransactionStatus.DISPUTED]: t('tx_disputed'),
    };

    const TX_STATUS_ICON: Record<TransactionStatus, React.ReactNode> = {
        [TransactionStatus.PAID]:     <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />,
        [TransactionStatus.PENDING]:  <Clock className="w-3.5 h-3.5 text-[#F59E0B]" />,
        [TransactionStatus.OVERDUE]:  <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444]" />,
        [TransactionStatus.EXEMPT]:   <CheckCircle className="w-3.5 h-3.5 text-[#38BDF8]" />,
        [TransactionStatus.DISPUTED]: <Scale className="w-3.5 h-3.5 text-[#F97316]" />,
    };

    const filtered = vessels.filter((v) => {
        return search === '' ||
            v.name.toLowerCase().includes(search.toLowerCase()) ||
            v.imoNumber.includes(search) ||
            v.mmsi.includes(search);
    });

    // KPIs
    const totalVessels    = vessels.length;
    const compliantCount  = vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.COMPLIANT).length;
    const paymentDueCount = vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE).length;
    const nonCompliantCount = vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT).length;

    // Recent transactions for the fleet
    const vesselIds = new Set(vessels.map((v) => v.id));
    const fleetTransactions = transactions
        .filter((tx) => vesselIds.has(tx.vesselId))
        .slice(0, 10);

    // Access guard
    if (!isShipRole(role) && role !== UserRole.SUPERADMIN) {
        return (
            <div className="flex items-center justify-center h-full text-[var(--os-text-muted)] text-sm p-8">
                {t('access_denied')}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Top KPI bar */}
            <div className="border-b border-[var(--os-border)] bg-[var(--os-surface)] px-3 sm:px-5 py-2.5 flex items-center gap-3 sm:gap-6 overflow-x-auto">
                <KpiPill label={t('kpi_total_vessels')} value={String(totalVessels)} color="var(--os-text-primary)" />
                <KpiPill label={t('kpi_compliant')} value={String(compliantCount)} color="#22C55E" />
                <KpiPill label={t('kpi_payment_due')} value={String(paymentDueCount)} color="#EF4444" />
                <KpiPill label={t('kpi_non_compliant')} value={String(nonCompliantCount)} color="#F59E0B" />
            </div>

            {/* Toolbar */}
            <div className="px-3 sm:px-5 py-3 border-b border-[var(--os-border)] flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-0 sm:min-w-48">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--os-text-muted)]" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('search_placeholder')}
                        className="w-full h-9 pl-9 pr-4 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/50 transition-colors"
                    />
                </div>
                <div className="hidden sm:flex items-center gap-2 ml-auto">
                    <button className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors">
                        <Download className="w-3.5 h-3.5" />
                        {t('export_csv')}
                    </button>
                </div>
            </div>

            {/* Vessel cards grid */}
            <div className="flex-1 overflow-auto px-3 sm:px-5 py-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">{t('my_vessels')}</h3>
                {filtered.length === 0 ? (
                    <div className="px-4 py-12 text-center text-[var(--os-text-muted)] text-xs">
                        {t('no_vessels_found')}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
                        {filtered.map((v) => (
                            <FleetVesselCard
                                key={v.id}
                                vessel={v}
                                complianceLabel={COMPLIANCE_LABEL}
                                categoryLabel={CATEGORY_LABEL}
                            />
                        ))}
                    </div>
                )}

                {/* Transaction history */}
                {fleetTransactions.length > 0 && (
                    <>
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3 mt-6">{t('recent_invoices')}</h3>
                        <div className="os-card overflow-hidden">
                            <div className="divide-y divide-[var(--os-border)]">
                                {fleetTransactions.map((tx) => {
                                    const date = new Date(tx.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                                    return (
                                        <div key={tx.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                                            {TX_STATUS_ICON[tx.status]}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-semibold text-[var(--os-text-primary)] truncate">{tx.vesselName}</span>
                                                    <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{tx.ref}</span>
                                                </div>
                                            </div>
                                            <OsBadge variant={transactionVariant(tx.status)} label={STATUS_LABEL[tx.status]} size="sm" />
                                            <span className="text-xs font-bold tabular-nums text-[var(--os-text-primary)]">
                                                ${tx.taxAmountUsd.toLocaleString()}
                                            </span>
                                            <span className="text-[10px] text-[var(--os-text-muted)] hidden sm:block">{date}</span>
                                            {(tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.OVERDUE) && (
                                                <a
                                                    href={`/dashboard/disputes?new=true&txn=${tx.id}`}
                                                    className="text-[10px] font-semibold text-[#38BDF8] hover:underline whitespace-nowrap"
                                                >
                                                    {t('contest')}
                                                </a>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Footer */}
            <div className="px-3 sm:px-5 py-2.5 border-t border-[var(--os-border)] flex items-center justify-between text-xs text-[var(--os-text-muted)]">
                <span>{t('showing_vessels', { from: 1, to: filtered.length, total: vessels.length })}</span>
            </div>
        </div>
    );
}

// ── Sub components ────────────────────────────────────────────────────────────

function KpiPill({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div className="flex flex-col flex-shrink-0">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{label}</span>
            <span className="text-sm font-bold tabular-nums" style={{ color }}>{value}</span>
        </div>
    );
}

function FleetVesselCard({
    vessel: v,
    complianceLabel,
    categoryLabel,
}: {
    vessel: SecureVessel;
    complianceLabel: Record<VesselComplianceStatus, string>;
    categoryLabel: Record<VesselCategory, string>;
}) {
    const t = useTranslations('MyFleet');
    const isAlert = v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE || v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT;

    return (
        <div
            className={`os-card p-4 flex flex-col gap-3 transition-colors hover:bg-[rgba(255,255,255,0.02)] ${
                isAlert ? 'border-l-2 border-l-[#EF4444]' : ''
            }`}
        >
            {/* Top row: vessel info + badge */}
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center justify-center flex-shrink-0">
                    <Ship className="w-4 h-4 text-[var(--os-text-muted)]" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--os-text-primary)] truncate">{v.name}</p>
                    <p className="text-[10px] text-[var(--os-text-muted)]">IMO: {v.imoNumber} &middot; {v.flagCode}</p>
                </div>
                <OsBadge variant={COMPLIANCE_VARIANT[v.complianceStatus]} label={complianceLabel[v.complianceStatus]} />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                    <p className="text-[10px] text-[var(--os-text-muted)]">{t('category')}</p>
                    <p className="font-medium text-[var(--os-text-primary)]">{categoryLabel[v.category]}</p>
                </div>
                <div>
                    <p className="text-[10px] text-[var(--os-text-muted)]">{t('dwt')}</p>
                    <p className="font-medium text-[var(--os-text-primary)]">{v.grossTonnageDwt.toLocaleString()}</p>
                </div>
                <div>
                    <p className="text-[10px] text-[var(--os-text-muted)]">{t('estimated_emissions')}</p>
                    <p className="font-medium text-[var(--os-text-primary)]">{v.estimatedEmissionsTco2} tCO2</p>
                </div>
                <div>
                    <p className="text-[10px] text-[var(--os-text-muted)]">{t('tax_liability')}</p>
                    <p className="font-mono font-bold text-[#EF4444]">${v.taxLiabilityUsd.toLocaleString()}</p>
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 border-t border-[var(--os-border)]">
                <a
                    href={`/dashboard/invoices?vessel=${v.id}`}
                    className="flex items-center gap-1.5 text-[10px] font-semibold text-[#38BDF8] hover:underline"
                >
                    <FileText className="w-3 h-3" />
                    {t('view_details')}
                </a>
                {(v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE || v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT) && (
                    <a
                        href={`/dashboard/disputes?new=true&vessel=${v.id}`}
                        className="flex items-center gap-1.5 text-[10px] font-semibold text-[#F97316] hover:underline ml-auto"
                    >
                        <Scale className="w-3 h-3" />
                        {t('contest_invoice')}
                    </a>
                )}
            </div>
        </div>
    );
}
