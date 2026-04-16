'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Search, Plus, Ship, FileText, CheckCircle, Clock, AlertTriangle, ChevronRight, ArrowLeft, Scale } from 'lucide-react';
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
    } | null>(null);
    const [recordPaymentTx, setRecordPaymentTx] = React.useState<Transaction | null>(null);
    const [paymentLoading, setPaymentLoading] = React.useState<string | null>(null);
    const [paymentError, setPaymentError]     = React.useState<string | null>(null);

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
                setWireInstructions({
                    instructions: result.wireInstructions,
                    invoiceRef: result.wireInstructions.reference.split('/')[1] || tx.ref,
                    vesselName: tx.vesselName,
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
            const res = await fetch('/api/transactions/mark-paid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    // Auto-select transaction from URL params (?vessel=<imo> or ?tx=<ref>)
    React.useEffect(() => {
        if (typeof window === 'undefined' || transactions.length === 0) return;
        const params = new URLSearchParams(window.location.search);
        const vesselImo = params.get('vessel');
        const txRef = params.get('tx');

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
        const matchSearch = search === '' ||
            tx.vesselName.toLowerCase().includes(search.toLowerCase()) ||
            tx.vesselImo.includes(search) ||
            tx.ref.toLowerCase().includes(search.toLowerCase()) ||
            tx.id.includes(search.toLowerCase());
        return matchTab && matchSearch;
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

                    {/* Search */}
                    <div className="px-3 pb-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('search_placeholder')}
                                className="w-full h-8 pl-8 pr-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/50 transition-colors"
                            />
                        </div>
                    </div>

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
            {proForma && <ProFormaModal tx={proForma} onClose={() => setProForma(null)} />}

            {/* Wire transfer instructions modal */}
            {wireInstructions && (
                <WireTransferModal
                    instructions={wireInstructions.instructions}
                    invoiceRef={wireInstructions.invoiceRef}
                    vesselName={wireInstructions.vesselName}
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
    const [activeTab, setActiveTab] = React.useState<'details' | 'payment' | 'audit'>('details');
    const invoiceRef = tx.ref;
    const isOverdue  = tx.status === TransactionStatus.OVERDUE;
    const isPaid     = tx.status === TransactionStatus.PAID;
    const canContest = role === UserRole.SHIPPING_AGENT && (tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.OVERDUE);

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
                    <OsButton variant="secondary" size="sm" icon={<FileText className="w-3.5 h-3.5" />} onClick={onGenerateProForma}>
                        {t('generate_statement')}
                    </OsButton>
                    {!isPaid && (
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
                        <a href={`/dashboard/disputes?new=true&txn=${tx.id}`}>
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
                {(['details', 'payment', 'audit'] as const).map((tabKey) => (
                    <button
                        key={tabKey}
                        onClick={() => setActiveTab(tabKey)}
                        className={`px-4 py-2 text-xs font-semibold capitalize transition-colors border-b-2 -mb-px ${
                            activeTab === tabKey
                                ? 'border-[#00D97E] text-[#00D97E]'
                                : 'border-transparent text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]'
                        }`}
                    >
                        {tabKey === 'details' ? t('tab_details') : tabKey === 'payment' ? t('tab_payment') : t('tab_audit_trail')}
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
                </div>
            )}

            {activeTab === 'payment' && (
                <div className="flex flex-col gap-3">
                    <div className="os-card p-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">{t('payment_capture')}</h4>
                        {[
                            { label: t('payment_bank'), sub: t('payment_bank_sub'), badge: 'LIVE', badgeColor: '#00D97E' },
                            { label: t('payment_swift'), sub: t('payment_swift_sub'), badge: null, badgeColor: '' },
                            { label: t('payment_manual'), sub: t('payment_manual_sub'), badge: 'ADV. PREF+', badgeColor: '#F59E0B' },
                        ].map(({ label, sub, badge, badgeColor }) => (
                            <button key={label} className="w-full flex items-center justify-between p-3 rounded-xl border border-[var(--os-border)] hover:border-[var(--os-border-strong)] hover:bg-[var(--os-surface-2)] transition-all mb-2 last:mb-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-[var(--os-surface-3)] flex items-center justify-center">
                                        <FileText className="w-4 h-4 text-[var(--os-text-muted)]" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-xs font-semibold text-[var(--os-text-primary)]">{label}</p>
                                        <p className="text-[10px] text-[var(--os-text-muted)]">{sub}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {badge && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${badgeColor}18`, color: badgeColor }}>
                                            {badge}
                                        </span>
                                    )}
                                    <ChevronRight className="w-4 h-4 text-[var(--os-text-muted)]" />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'audit' && (
                <TransactionAuditTrail transactionId={tx.id} />
            )}

            {/* Pro-forma / Invoice / Receipt CTA — adapts to transaction status */}
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
            ) : (
                // Unpaid (or paid without a generated receipt yet) — open the modal
                <OsButton
                    variant="primary"
                    size="md"
                    icon={<FileText className="w-4 h-4" />}
                    onClick={onGenerateProForma}
                    className="w-full"
                >
                    {isPaid ? t('view_tax_invoice') : t('generate_proforma_pdf')}
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
