'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Search, Plus, Ship, FileText, CheckCircle, Clock, AlertTriangle, ArrowLeft, Scale, Download } from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { useTransactions } from '@/hooks/useTransactions';
import { useKpis } from '@/hooks/useKpis';
import { useRole } from '@/lib/RoleContext';
import { Transaction, TransactionStatus, TransactionType, UserRole } from '@/types/secure';
import { transactionVariant } from '@/lib/badgeUtils';
import { ProFormaModal } from './ProFormaModal';
import { WireTransferModal, type WireTransferInstructions } from './WireTransferModal';
import { RecordPaymentModal, type RecordPaymentInput } from './RecordPaymentModal';
import { createClient } from '@/lib/supabase/client';
import { fetchJurisdictionName } from '@/lib/jurisdictionName';

const STATUS_ICON: Record<TransactionStatus, React.ReactNode> = {
    [TransactionStatus.PAID]:     <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />,
    [TransactionStatus.PENDING]:  <Clock className="w-3.5 h-3.5 text-[#F59E0B]" />,
    [TransactionStatus.OVERDUE]:  <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444]" />,
    [TransactionStatus.EXEMPT]:   <CheckCircle className="w-3.5 h-3.5 text-[#38BDF8]" />,
    [TransactionStatus.DISPUTED]: <AlertTriangle className="w-3.5 h-3.5 text-[#F97316]" />,
};

type TabFilter = 'ALL' | TransactionStatus;

export function InvoicesPage() {
    const t = useTranslations('InvoicesPage');
    const { data: transactions, refetch: refetchTransactions } = useTransactions();
    const { data: kpis } = useKpis();
    const { role, user } = useRole();
    const [tab, setTab]             = React.useState<TabFilter>('ALL');
    const [search, setSearch]       = React.useState('');
    const [selected, setSelected]   = React.useState<Transaction | null>(null);
    const [proForma, setProForma]   = React.useState<Transaction | null>(null);
    const [wireInstructions, setWireInstructions] = React.useState<{
        instructions: WireTransferInstructions;
        invoiceRef: string;
        vesselName: string;
        transactionId: string;
    } | null>(null);
    const [recordPaymentTx, setRecordPaymentTx] = React.useState<Transaction | null>(null);
    const [paymentLoading, setPaymentLoading] = React.useState<string | null>(null);
    const [paymentError, setPaymentError]     = React.useState<string | null>(null);
    const [proFormaJurisdictionName, setProFormaJurisdictionName] = React.useState<string>('Republic of Somaliland');

    // Resolve the jurisdiction display name whenever the proforma modal is opened.
    React.useEffect(() => {
        let cancelled = false;
        const client = createClient();
        // fetchJurisdictionName handles null/undefined with the legacy fallback
        fetchJurisdictionName(client, proForma?.jurisdictionId ?? null)
            .then((name) => { if (!cancelled) setProFormaJurisdictionName(name); });
        return () => { cancelled = true; };
    }, [proForma?.jurisdictionId]);

    // ── Pay Now handler — calls /api/payments/create ──
    async function handlePayNow(tx: Transaction) {
        setPaymentLoading(tx.id);
        setPaymentError(null);
        try {
            const res = await fetch('/api/payments/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transactionId: tx.id }),
            });
            const result = await res.json();
            if (!res.ok || !result.success) {
                throw new Error(result.error || 'Payment creation failed');
            }
            // Wire transfer → show modal with instructions
            if (result.provider === 'wire_transfer' && result.wireInstructions) {
                // Fallback case (online provider failed → wire) : on signale au user
                // pour qu'il comprenne pourquoi il voit du wire alors qu'un autre
                // provider est configuré côté admin. `result.fallback` est ajouté
                // côté serveur (route /api/payments/create) quand on retry en wire.
                if (result.fallback && result.originalProvider) {
                    setPaymentError(
                        `${result.originalProvider} is temporarily unavailable — falling back to wire transfer.`,
                    );
                }
                setWireInstructions({
                    instructions: result.wireInstructions,
                    invoiceRef: result.wireInstructions.reference.split('/')[1] || tx.ref,
                    vesselName: tx.vesselName,
                    transactionId: tx.id,
                });
            } else if (result.checkoutUrl) {
                // Online provider → redirect to checkout
                window.location.href = result.checkoutUrl;
            } else {
                throw new Error('No checkout URL or wire instructions returned');
            }
        } catch (err) {
            setPaymentError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setPaymentLoading(null);
        }
    }

    // ── Record Payment: open the modal so the admin can pick method + ref + notes ──
    function handleOpenRecordPayment(tx: Transaction) {
        setPaymentError(null);
        setRecordPaymentTx(tx);
    }

    // ── Confirm Payment: actually POST to mark-paid with the modal's input ──
    async function handleConfirmPayment(input: RecordPaymentInput) {
        if (!recordPaymentTx) return;
        setPaymentLoading(recordPaymentTx.id);
        setPaymentError(null);
        try {
            // Idempotency-Key: one UUID per click. If the network drops the
            // response or the user double-clicks, the server replays the
            // cached response instead of re-flipping status / re-emitting
            // audit log / re-generating receipt / re-sending email.
            // See migration 039 + frontend/src/app/api/lib/idempotency.ts.
            const idempotencyKey = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
                ? crypto.randomUUID()
                : `mp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const res = await fetch('/api/transactions/mark-paid', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey,
                },
                body: JSON.stringify({
                    transactionId: recordPaymentTx.id,
                    actingUserId: user.id,
                    actingUserName: user.fullName,
                    paymentMethod: input.paymentMethod,
                    paymentReference: input.paymentReference,
                    paymentNotes: input.paymentNotes,
                }),
            });
            const result = await res.json();
            if (!res.ok || !result.success) {
                throw new Error(result.error || 'Mark as paid failed');
            }
            // Refresh + close
            refetchTransactions();
            setRecordPaymentTx(null);
            setSelected(null);
        } catch (err) {
            setPaymentError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setPaymentLoading(null);
        }
    }

    // Optional vessel-scope filter driven by the URL (?vessel=<imo>). When
    // present, the LEFT list is filtered to that vessel and the most recent
    // tx is auto-selected. Armateurs reach this via "View Payments" on the
    // LiveMapPanel popup or on MyFleet vessel cards.
    const [vesselImoFilter, setVesselImoFilter] = React.useState<string | null>(null);

    // Auto-select transaction from URL params (?vessel=<imo> or ?tx=<ref>)
    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const vesselImo = params.get('vessel');
        const txRef = params.get('tx');
        setVesselImoFilter(vesselImo);
        if (transactions.length === 0) return;

        if (txRef) {
            const match = transactions.find((tx) => tx.ref === txRef);
            if (match) setSelected(match);
            return;
        }
        if (vesselImo) {
            // Find latest transaction for this vessel by IMO
            const matches = transactions
                .filter((tx) => tx.vesselImo === vesselImo)
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            if (matches.length > 0) setSelected(matches[0]);
        }
    }, [transactions]);

    // Exports the currently visible (filtered) list to a CSV blob. Runs fully
    // client-side — no server round-trip, no PII leaves the tab. Column order
    // matches the table columns visible in the UI for consistency with what
    // the user sees.
    function handleExportCsv() {
        const rows = filtered;
        if (rows.length === 0) return;
        const header = ['date', 'ref', 'vessel_name', 'vessel_imo', 'type', 'amount_usd', 'status', 'paid_at'];
        const body = rows.map((tx) => [
            new Date(tx.createdAt).toISOString(),
            tx.ref,
            tx.vesselName,
            tx.vesselImo,
            tx.transactionType,
            String(tx.taxAmountUsd),
            tx.status,
            tx.paidAt ?? '',
        ]);
        const escape = (v: string) =>
            /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        const csv =
            [header, ...body].map((row) => row.map(escape).join(',')).join('\n') + '\n';
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = vesselImoFilter
            ? `payments-vessel-${vesselImoFilter}-${stamp}.csv`
            : `payments-${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    const STATUS_LABEL: Record<TransactionStatus, string> = {
        [TransactionStatus.PAID]:     t('status_paid'),
        [TransactionStatus.PENDING]:  t('status_pending'),
        [TransactionStatus.OVERDUE]:  t('status_overdue'),
        [TransactionStatus.EXEMPT]:   t('status_exempt'),
        [TransactionStatus.DISPUTED]: t('status_disputed'),
    };

    const TX_TYPE_LABEL: Record<TransactionType, string> = {
        [TransactionType.ENTRY_TAX]:   t('type_entry_tax'),
        [TransactionType.TRANSIT_FEE]: t('type_transit_fee'),
        [TransactionType.PORT_STAY]:   t('type_port_stay'),
    };

    const filtered = transactions.filter((tx) => {
        const matchTab = tab === 'ALL' || tx.status === tab;
        const matchVessel = !vesselImoFilter || tx.vesselImo === vesselImoFilter;
        const matchSearch = search === '' ||
            tx.vesselName.toLowerCase().includes(search.toLowerCase()) ||
            tx.vesselImo.includes(search) ||
            tx.ref.toLowerCase().includes(search.toLowerCase()) ||
            tx.id.includes(search.toLowerCase());
        return matchTab && matchVessel && matchSearch;
    });

    const totalRevenue = transactions
        .filter((tr) => tr.status === TransactionStatus.PAID)
        .reduce((s, tr) => s + tr.taxAmountUsd, 0);

    return (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 3.5rem - 2rem)' }}>
            {/* Top KPI bar */}
            <div className="border-b border-[var(--os-border)] px-3 sm:px-5 py-2.5 flex items-center gap-3 sm:gap-6 overflow-x-auto">
                <div className="flex-shrink-0">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('kpi_total_revenue')}</p>
                    <p className="text-base font-bold text-[#00D97E] tabular-nums">${(totalRevenue / 1000).toFixed(1)}K</p>
                </div>
                <div className="flex-shrink-0">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('kpi_pending_clearance')}</p>
                    <p className="text-base font-bold text-[#F59E0B] tabular-nums">
                        {t('kpi_vessels_count', { count: transactions.filter((tr) => tr.status === TransactionStatus.PENDING).length })}
                    </p>
                </div>
                <div className="flex-shrink-0 hidden sm:block">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('kpi_carbon_offset')}</p>
                    <p className="text-base font-bold text-[var(--os-text-primary)] tabular-nums">{t('kpi_tonnes', { value: kpis.creditsRetiredTons.toLocaleString() })}</p>
                </div>
                <div className="ml-auto flex items-center gap-2 flex-shrink-0 hidden sm:flex">
                    <span className="text-[10px] text-[var(--os-text-muted)]">{t('sync_queue')}</span>
                    <span className="text-[10px] font-bold text-[#00D97E]">{t('sync_pending', { count: 0 })}</span>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Left list — on mobile: hidden when an invoice is selected */}
                <div className={`w-full sm:w-72 md:w-80 border-r border-[var(--os-border)] flex flex-col flex-shrink-0 ${selected ? 'hidden sm:flex' : 'flex'}`}>
                    {/* Tab filters */}
                    <div className="px-3 pt-3 pb-2 flex gap-1 flex-wrap overflow-x-auto">
                        {(['ALL', TransactionStatus.PENDING, TransactionStatus.OVERDUE, TransactionStatus.PAID, TransactionStatus.DISPUTED] as TabFilter[]).map((f) => (
                            <button
                                key={f}
                                onClick={() => setTab(f)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide transition-all ${
                                    tab === f
                                        ? 'bg-[var(--os-surface-3)] text-[var(--os-text-primary)] border border-[var(--os-border-strong)]'
                                        : 'text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]'
                                }`}
                            >
                                {f === 'ALL' ? t('filter_all') : STATUS_LABEL[f as TransactionStatus]}
                            </button>
                        ))}
                    </div>

                    {/* Search + Export row */}
                    <div className="px-3 pb-2 flex items-center gap-2">
                        <div className="relative flex-1 min-w-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('search_placeholder')}
                                className="w-full h-8 pl-8 pr-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/50 transition-colors"
                            />
                        </div>
                        <button
                            onClick={handleExportCsv}
                            disabled={filtered.length === 0}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border border-[var(--os-border)] text-xs font-semibold text-[var(--os-text-secondary)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                            aria-label={t('export_csv')}
                            title={t('export_csv')}
                        >
                            <Download className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{t('export_csv')}</span>
                        </button>
                    </div>
                    {vesselImoFilter && (
                        <div className="px-3 pb-2 flex items-center gap-2 text-[11px] text-[var(--os-text-muted)]">
                            <Ship className="w-3 h-3" />
                            <span>{t('filter_by_vessel', { imo: vesselImoFilter })}</span>
                            <button
                                onClick={() => {
                                    setVesselImoFilter(null);
                                    if (typeof window !== 'undefined') {
                                        const url = new URL(window.location.href);
                                        url.searchParams.delete('vessel');
                                        window.history.replaceState(null, '', url.toString());
                                    }
                                }}
                                className="ml-auto text-[var(--os-brand-green)] hover:underline"
                            >
                                {t('filter_clear')}
                            </button>
                        </div>
                    )}

                    {/* Invoice list */}
                    <div className="flex-1 overflow-y-auto divide-y divide-[var(--os-border)]">
                        {filtered.map((tx) => {
                            const isSelected = selected?.id === tx.id;
                            const date = new Date(tx.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                            const isOverdue = tx.status === TransactionStatus.OVERDUE;
                            return (
                                <button
                                    key={tx.id}
                                    onClick={() => setSelected(tx)}
                                    className={`w-full text-left px-4 py-3 transition-colors ${
                                        isSelected ? 'bg-[var(--os-surface-2)]' : 'hover:bg-[rgba(255,255,255,0.02)]'
                                    } ${isOverdue ? 'border-l-2 border-l-[#EF4444]' : ''}`}
                                >
                                    <div className="flex items-start justify-between mb-1">
                                        <div className="flex items-center gap-1.5">
                                            {STATUS_ICON[tx.status]}
                                            <span className="text-[10px] font-mono text-[var(--os-text-muted)]">
                                                {tx.ref}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-[var(--os-text-muted)]">{date}</span>
                                    </div>
                                    <p className="text-xs font-semibold text-[var(--os-text-primary)] truncate">{tx.vesselName}</p>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-[10px] text-[var(--os-text-muted)]">{TX_TYPE_LABEL[tx.transactionType]}</span>
                                        <span className="text-xs font-bold tabular-nums" style={{
                                            color: tx.status === TransactionStatus.PAID ? '#22C55E' :
                                                   tx.status === TransactionStatus.OVERDUE ? '#EF4444' : 'var(--os-text-primary)'
                                        }}>
                                            ${tx.taxAmountUsd.toLocaleString()}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                        {filtered.length === 0 && (
                            <div className="px-4 py-8 text-center text-xs text-[var(--os-text-muted)]">{t('no_invoices_found')}</div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 border-t border-[var(--os-border)] text-[10px] text-[var(--os-text-muted)]">
                        {t('showing_invoices', { from: 1, to: filtered.length, total: transactions.length })}
                    </div>
                </div>

                {/* Right detail */}
                <div className={`flex-1 overflow-y-auto ${selected ? 'flex flex-col' : 'hidden sm:flex'}`}>
                    {selected ? (
                        <>
                            {/* Mobile back button */}
                            <button
                                onClick={() => setSelected(null)}
                                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] border-b border-[var(--os-border)] sm:hidden"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                {t('filter_all')}
                            </button>
                            <InvoiceDetail
                                tx={selected}
                                onGenerateProForma={() => setProForma(selected)}
                                onPayNow={() => handlePayNow(selected)}
                                onRecordPayment={() => handleOpenRecordPayment(selected)}
                                isPaymentLoading={paymentLoading === selected.id}
                                paymentError={paymentError}
                                role={role}
                            />
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-[var(--os-text-muted)] text-sm">
                            {t('select_invoice_prompt')}
                        </div>
                    )}
                </div>
            </div>

            {/* Pro-forma modal */}
            {proForma && (
                <ProFormaModal
                    tx={proForma}
                    onClose={() => setProForma(null)}
                    onPayNow={() => {
                        const tx = proForma;
                        setProForma(null);
                        handlePayNow(tx);
                    }}
                    jurisdictionName={proFormaJurisdictionName}
                />
            )}

            {/* Wire transfer instructions modal */}
            {wireInstructions && (
                <WireTransferModal
                    instructions={wireInstructions.instructions}
                    invoiceRef={wireInstructions.invoiceRef}
                    vesselName={wireInstructions.vesselName}
                    transactionId={wireInstructions.transactionId}
                    onClose={() => setWireInstructions(null)}
                />
            )}

            {/* Record Payment modal — admin captures method + reference + notes */}
            {recordPaymentTx && (
                <RecordPaymentModal
                    invoiceRef={recordPaymentTx.ref}
                    vesselName={recordPaymentTx.vesselName}
                    amountUsd={recordPaymentTx.taxAmountUsd}
                    isLoading={paymentLoading === recordPaymentTx.id}
                    error={paymentError}
                    onConfirm={handleConfirmPayment}
                    onClose={() => setRecordPaymentTx(null)}
                    transactionId={recordPaymentTx.id}
                    proofFiles={recordPaymentTx.paymentProofFiles}
                />
            )}
        </div>
    );
}

// ── Invoice Detail Panel ──────────────────────────────────────────────────────

function InvoiceDetail({
    tx,
    onGenerateProForma,
    onPayNow,
    onRecordPayment,
    isPaymentLoading,
    paymentError,
    role,
}: {
    tx: Transaction;
    onGenerateProForma: () => void;
    onPayNow: () => void;
    onRecordPayment: () => void;
    isPaymentLoading: boolean;
    paymentError: string | null;
    role: UserRole;
}) {
    const t = useTranslations('InvoicesPage');
    const [activeTab, setActiveTab] = React.useState<'details' | 'audit'>('details');
    const invoiceRef = tx.ref;
    const isOverdue  = tx.status === TransactionStatus.OVERDUE;
    const isPaid     = tx.status === TransactionStatus.PAID;
    const isArmateur = role === UserRole.SHIPPING_AGENT;
    const canContest = isArmateur && (tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.OVERDUE);

    const STATUS_LABEL: Record<TransactionStatus, string> = {
        [TransactionStatus.PAID]:     t('status_paid'),
        [TransactionStatus.PENDING]:  t('status_pending'),
        [TransactionStatus.OVERDUE]:  t('status_overdue'),
        [TransactionStatus.EXEMPT]:   t('status_exempt'),
        [TransactionStatus.DISPUTED]: t('status_disputed'),
    };

    // Simple fee breakdown based on total
    const containerFee = Math.round(tx.taxAmountUsd * 0.75);
    const portCallFee  = Math.round(tx.taxAmountUsd * 0.20);
    const securityFee  = tx.taxAmountUsd - containerFee - portCallFee;

    return (
        <div className="p-3 sm:p-5 flex flex-col gap-4">
            {/* Invoice header */}
            <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-[var(--os-text-primary)]">{invoiceRef}</span>
                        <OsBadge variant={transactionVariant(tx.status)} label={STATUS_LABEL[tx.status]} />
                    </div>
                    <p className="text-xs text-[var(--os-text-muted)]">
                        {t('issued_to', { vessel: tx.vesselName })}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {!isArmateur && (
                        <OsButton variant="secondary" size="sm" icon={<FileText className="w-3.5 h-3.5" />} onClick={onGenerateProForma}>
                            {t('generate_statement')}
                        </OsButton>
                    )}
                    {!isPaid && !isArmateur && (
                        <OsButton
                            variant="primary"
                            size="sm"
                            icon={<CheckCircle className="w-3.5 h-3.5" />}
                            onClick={onRecordPayment}
                            disabled={isPaymentLoading}
                        >
                            {isPaymentLoading ? 'Recording…' : t('record_payment')}
                        </OsButton>
                    )}
                    {canContest && (
                        <a href="/dashboard/disputes?new=true">
                            <OsButton variant="outline" size="sm" icon={<Scale className="w-3.5 h-3.5" />}>
                                {t('contest_invoice')}
                            </OsButton>
                        </a>
                    )}
                </div>
            </div>

            {/* Port gate alert */}
            {isOverdue && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                    <div>
                        <p className="text-xs font-bold text-[#EF4444]">{t('port_gate_locked')}</p>
                        <p className="text-[10px] text-[var(--os-text-muted)]">{t('payment_clearance_required')}</p>
                    </div>
                    <button className="ml-auto text-[10px] font-bold text-[#EF4444] border border-[#EF4444]/30 px-2 py-1 rounded-lg hover:bg-[rgba(239,68,68,0.1)] transition-colors">
                        {t('override')}
                    </button>
                </div>
            )}

            {/* Payment error banner */}
            {paymentError && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                    <p className="text-xs text-[#EF4444]">{paymentError}</p>
                </div>
            )}

            {/* Pay Now CTA — for shipping agents on unpaid invoices */}
            {!isPaid && role === UserRole.SHIPPING_AGENT && (
                <OsButton
                    variant="primary"
                    size="md"
                    icon={<CheckCircle className="w-4 h-4" />}
                    onClick={onPayNow}
                    disabled={isPaymentLoading}
                    className="w-full"
                >
                    {isPaymentLoading ? 'Creating payment session…' : `Pay Now — $${tx.taxAmountUsd.toLocaleString()}`}
                </OsButton>
            )}

            {/* Tabs */}
            <div className="flex items-center gap-0.5 border-b border-[var(--os-border)] pb-0">
                {(['details', 'audit'] as const).map((tabKey) => (
                    <button
                        key={tabKey}
                        onClick={() => setActiveTab(tabKey)}
                        className={`px-4 py-2 text-xs font-semibold capitalize transition-colors border-b-2 -mb-px ${
                            activeTab === tabKey
                                ? 'border-[#00D97E] text-[#00D97E]'
                                : 'border-transparent text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]'
                        }`}
                    >
                        {tabKey === 'details' ? t('tab_details') : t('tab_audit_trail')}
                    </button>
                ))}
            </div>

            {activeTab === 'details' && (
                <div className="os-card p-5">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-4">{t('invoice_summary')}</h4>
                    <div className="flex flex-col gap-2 mb-4">
                        {[
                            { label: t('fee_container'), amount: containerFee },
                            { label: t('fee_port_call'), amount: portCallFee },
                            { label: t('fee_security_surcharge'), amount: securityFee },
                        ].map(({ label, amount }) => (
                            <div key={label} className="flex justify-between text-sm py-1 border-b border-[var(--os-border)] last:border-0">
                                <span className="text-[var(--os-text-secondary)]">{label}</span>
                                <span className="font-mono font-medium text-[var(--os-text-primary)]">${amount.toLocaleString()}.00</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-between items-center pt-2">
                        <span className="text-sm font-bold text-[var(--os-text-primary)]">{t('total_due')}</span>
                        <span className="text-xl font-bold text-[#00D97E] tabular-nums">${tx.taxAmountUsd.toLocaleString()}.00</span>
                    </div>

                    {tx.paymentProofFiles && tx.paymentProofFiles.length > 0 && (
                        <div className="mt-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                                {t('proof_submitted_label', { count: tx.paymentProofFiles.length })}
                            </p>
                            <div className="flex flex-col gap-1">
                                {tx.paymentProofFiles.map((f, i) => (
                                    <button
                                        key={f.path}
                                        onClick={async () => {
                                            const res = await fetch(`/api/transactions/${tx.id}/proof/${i}`);
                                            if (res.ok) window.open((await res.json()).url, '_blank', 'noopener');
                                        }}
                                        className="text-left text-xs text-emerald-400 hover:underline"
                                    >
                                        {f.path.split('/').pop()}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'audit' && (
                <TransactionAuditTrail transactionId={tx.id} />
            )}

            {/* Pro-forma / Invoice / Receipt CTA — adapts to transaction status & role.
              * Armateurs (SHIPPING_AGENT) ne voient PAS le bouton "Generate Pro-forma":
              * le pro-forma est émis par l'autorité portuaire et envoyé par email,
              * l'armateur n'a pas vocation à le re-générer (sinon risque de copies
              * divergentes hors audit trail). Ils gardent les autres branches:
              * - PAID + receipt URL → Download Official Receipt
              * - PAID sans receipt → View tax invoice (lecture seule du doc émis)
              */}
            {isPaid && tx.receiptPdfUrl ? (
                // PAID with a real receipt PDF — open the receipt directly
                <a
                    href={tx.receiptPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full"
                >
                    <OsButton
                        variant="primary"
                        size="md"
                        icon={<FileText className="w-4 h-4" />}
                        className="w-full"
                    >
                        Download Official Receipt (PDF)
                    </OsButton>
                </a>
            ) : isPaid ? (
                // Paid without a generated receipt yet — view tax invoice (tous rôles)
                <OsButton
                    variant="primary"
                    size="md"
                    icon={<FileText className="w-4 h-4" />}
                    onClick={onGenerateProForma}
                    className="w-full"
                >
                    {t('view_tax_invoice')}
                </OsButton>
            ) : role !== UserRole.SHIPPING_AGENT ? (
                // Unpaid + non-armateur (autorité portuaire, admin) — Generate Pro-forma
                <OsButton
                    variant="primary"
                    size="md"
                    icon={<FileText className="w-4 h-4" />}
                    onClick={onGenerateProForma}
                    className="w-full"
                >
                    {t('generate_proforma_pdf')}
                </OsButton>
            ) : (
                // Unpaid + armateur — view the pro-forma the system already
                // minted (same modal handler, just labeled for the debtor side).
                <OsButton
                    variant="secondary"
                    size="md"
                    icon={<FileText className="w-4 h-4" />}
                    onClick={onGenerateProForma}
                    className="w-full"
                >
                    {t('view_proforma_pdf')}
                </OsButton>
            )}
        </div>
    );
}

// ── Transaction Audit Trail ──────────────────────────────────────────────────
// Reads real audit_logs entries for a given transaction and renders the
// payment timeline (creation → invoice generation → email sent → payment
// received). Replaces the previously hardcoded fake trail.

interface AuditEntry {
    id: string;
    action: string;
    user_full_name: string;
    severity: string;
    created_at: string;
    details_json: Record<string, unknown>;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
    wire_transfer: 'Wire Transfer',
    cash:          'Cash',
    mobile_money:  'Mobile Money',
    card:          'Card',
    stripe:        'Stripe',
    paystack:      'Paystack',
    flutterwave:   'Flutterwave',
    wave:          'Wave Mobile Money',
    payoneer:      'Payoneer',
    other:         'Other',
};

function TransactionAuditTrail({ transactionId }: { transactionId: string }) {
    const [entries, setEntries] = React.useState<AuditEntry[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError]     = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const supabase = createClient();
                const { data, error: dbErr } = await supabase
                    .from('audit_logs')
                    .select('id, action, user_full_name, severity, created_at, details_json')
                    .eq('entity_type', 'Transaction')
                    .eq('entity_id', transactionId)
                    .order('created_at', { ascending: true });
                if (cancelled) return;
                if (dbErr) {
                    setError(dbErr.message);
                    setEntries([]);
                } else {
                    setEntries(data ?? []);
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [transactionId]);

    function describe(entry: AuditEntry): { label: string; sub: string; color: string } {
        const d = entry.details_json || {};
        const event = (d as { event?: string }).event;

        if (event === 'PAYMENT_RECEIVED' || (d as { newStatus?: string }).newStatus === 'PAID') {
            const method = (d as { paymentMethod?: string }).paymentMethod;
            const ref = (d as { paymentReference?: string }).paymentReference;
            const amount = (d as { amountUsd?: number }).amountUsd;
            const methodLabel = method ? PAYMENT_METHOD_LABEL[method] || method : 'Unknown method';
            const subParts = [
                `via ${methodLabel}`,
                amount ? `$${amount.toLocaleString()}` : null,
                ref ? `Ref: ${ref}` : null,
                `confirmed by ${entry.user_full_name}`,
            ].filter(Boolean);
            return {
                label: 'Payment received',
                sub: subParts.join(' · '),
                color: '#10B981',
            };
        }
        if (event === 'PAYMENT_CHECKOUT_CREATED') {
            const provider = (d as { provider?: string }).provider;
            return {
                label: 'Payment checkout created',
                sub: `Provider: ${provider || 'unknown'}`,
                color: '#38BDF8',
            };
        }
        if (entry.action === 'INVOICE_GENERATED') {
            const mode = (d as { mode?: string }).mode;
            const ref = (d as { invoiceRef?: string }).invoiceRef;
            return {
                label: mode === 'invoice' ? 'Tax invoice generated' : 'Pro-forma generated',
                sub: `${ref || ''} · by ${entry.user_full_name}`,
                color: '#10B981',
            };
        }
        if (entry.action === 'INVOICE_SENT') {
            const mode = (d as { mode?: string }).mode;
            const ref = (d as { invoiceRef?: string }).invoiceRef;
            const email = (d as { recipientEmail?: string }).recipientEmail;
            const delivery = (d as { delivery?: { succeeded?: boolean; error?: string | null } }).delivery;
            const status = delivery?.succeeded === false
                ? ' · delivery pending (SMTP not verified)'
                : '';
            return {
                label: mode === 'invoice' ? 'Tax invoice emailed to armateur' : 'Pro-forma emailed to armateur',
                sub: `${ref || ''}${email ? ` → ${email}` : ''} · by ${entry.user_full_name}${status}`,
                color: '#38BDF8',
            };
        }
        if (entry.action === 'TRANSACTION_UPDATED') {
            const oldS = (d as { previousStatus?: string; oldStatus?: string }).previousStatus
                || (d as { oldStatus?: string }).oldStatus;
            const newS = (d as { newStatus?: string }).newStatus;
            return {
                label: 'Transaction updated',
                sub: oldS && newS ? `${oldS} → ${newS} · by ${entry.user_full_name}` : `by ${entry.user_full_name}`,
                color: '#F59E0B',
            };
        }
        return {
            label: entry.action.replace(/_/g, ' ').toLowerCase(),
            sub: `by ${entry.user_full_name}`,
            color: '#94A3B8',
        };
    }

    return (
        <div className="os-card p-5">
            <div className="flex items-center justify-between mb-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">
                    Audit Trail
                </h4>
                {entries.length > 0 && (
                    <span className="text-[10px] text-[var(--os-text-muted)]">{entries.length} events</span>
                )}
            </div>

            {loading && (
                <p className="text-xs text-[var(--os-text-muted)]">Loading audit log…</p>
            )}

            {error && (
                <div className="p-3 rounded-xl text-[11px] text-[#EF4444] bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                    Failed to load audit log: {error}
                </div>
            )}

            {!loading && !error && entries.length === 0 && (
                <p className="text-xs text-[var(--os-text-muted)]">
                    No audit events yet for this transaction.
                </p>
            )}

            {!loading && entries.length > 0 && (
                <div className="flex flex-col gap-3">
                    {entries.map((e) => {
                        const { label, sub, color } = describe(e);
                        const ts = new Date(e.created_at);
                        const time = ts.toLocaleString('en-GB', {
                            day: '2-digit', month: 'short',
                            hour: '2-digit', minute: '2-digit',
                        });
                        const notes = (e.details_json as { paymentNotes?: string })?.paymentNotes;
                        return (
                            <div key={e.id} className="flex items-start gap-3">
                                <div
                                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                                    style={{ backgroundColor: `${color}14` }}
                                >
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-[var(--os-text-primary)]">{label}</p>
                                    <p className="text-[10px] text-[var(--os-text-muted)] break-words">{sub}</p>
                                    {notes && (
                                        <p className="text-[10px] text-[var(--os-text-secondary)] mt-1 italic">
                                            &ldquo;{notes}&rdquo;
                                        </p>
                                    )}
                                </div>
                                <span className="text-[10px] text-[var(--os-text-muted)] flex-shrink-0 whitespace-nowrap">
                                    {time}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
