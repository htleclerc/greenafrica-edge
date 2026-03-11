'use client';

import * as React from 'react';
import { Search, Plus, Ship, FileText, CheckCircle, Clock, AlertTriangle, ChevronRight } from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { mockTransactions, mockKpis } from '@/mock/datas/secureMock';
import { Transaction, TransactionStatus, TransactionType } from '@/types/secure';
import { transactionVariant } from '@/lib/badgeUtils';
import { ProFormaModal } from './ProFormaModal';

const STATUS_LABEL: Record<TransactionStatus, string> = {
    [TransactionStatus.PAID]:     'PAID',
    [TransactionStatus.PENDING]:  'PENDING',
    [TransactionStatus.OVERDUE]:  'OVERDUE',
    [TransactionStatus.EXEMPT]:   'EXEMPT',
    [TransactionStatus.DISPUTED]: 'DISPUTED',
};

const STATUS_ICON: Record<TransactionStatus, React.ReactNode> = {
    [TransactionStatus.PAID]:     <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />,
    [TransactionStatus.PENDING]:  <Clock className="w-3.5 h-3.5 text-[#F59E0B]" />,
    [TransactionStatus.OVERDUE]:  <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444]" />,
    [TransactionStatus.EXEMPT]:   <CheckCircle className="w-3.5 h-3.5 text-[#38BDF8]" />,
    [TransactionStatus.DISPUTED]: <AlertTriangle className="w-3.5 h-3.5 text-[#F97316]" />,
};

const TX_TYPE_LABEL: Record<TransactionType, string> = {
    [TransactionType.ENTRY_TAX]:   'Entry Tax',
    [TransactionType.TRANSIT_FEE]: 'Transit Fee',
    [TransactionType.PORT_STAY]:   'Port Stay',
};

type TabFilter = 'ALL' | TransactionStatus;

export function InvoicesPage() {
    const [tab, setTab]             = React.useState<TabFilter>('ALL');
    const [search, setSearch]       = React.useState('');
    const [selected, setSelected]   = React.useState<Transaction | null>(mockTransactions[0]);
    const [proForma, setProForma]   = React.useState<Transaction | null>(null);

    const filtered = mockTransactions.filter((tx) => {
        const matchTab = tab === 'ALL' || tx.status === tab;
        const matchSearch = search === '' ||
            tx.vesselName.toLowerCase().includes(search.toLowerCase()) ||
            tx.vesselImo.includes(search) ||
            tx.id.includes(search.toLowerCase());
        return matchTab && matchSearch;
    });

    const totalRevenue = mockTransactions
        .filter((t) => t.status === TransactionStatus.PAID)
        .reduce((s, t) => s + t.taxAmountUsd, 0);

    return (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 3.5rem - 2rem)' }}>
            {/* Top KPI bar */}
            <div className="border-b border-[var(--os-border)] px-5 py-2.5 flex items-center gap-6">
                <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">Total Revenue</p>
                    <p className="text-base font-bold text-[#00D97E] tabular-nums">${(totalRevenue / 1000).toFixed(1)}K</p>
                </div>
                <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">Pending Clearance</p>
                    <p className="text-base font-bold text-[#F59E0B] tabular-nums">
                        {mockTransactions.filter((t) => t.status === TransactionStatus.PENDING).length} Vessels
                    </p>
                </div>
                <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">Carbon Offset</p>
                    <p className="text-base font-bold text-[var(--os-text-primary)] tabular-nums">{mockKpis.creditsRetiredTons.toLocaleString()} Tonnes</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] text-[var(--os-text-muted)]">SYNC QUEUE</span>
                    <span className="text-[10px] font-bold text-[#00D97E]">0 PENDING</span>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Left list */}
                <div className="w-80 border-r border-[var(--os-border)] flex flex-col flex-shrink-0">
                    {/* Tab filters */}
                    <div className="px-3 pt-3 pb-2 flex gap-1 flex-wrap">
                        {(['ALL', TransactionStatus.PENDING, TransactionStatus.OVERDUE, TransactionStatus.PAID] as TabFilter[]).map((t) => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide transition-all ${
                                    tab === t
                                        ? 'bg-[var(--os-surface-3)] text-[var(--os-text-primary)] border border-[var(--os-border-strong)]'
                                        : 'text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]'
                                }`}
                            >
                                {t === 'ALL' ? 'All' : STATUS_LABEL[t as TransactionStatus]}
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
                                placeholder="Search vessel, IMO, or agent…"
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
                                                INV-{tx.id.split('-')[1].toUpperCase()}-{String(Math.floor(Math.random() * 900) + 100)}
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
                            <div className="px-4 py-8 text-center text-xs text-[var(--os-text-muted)]">No invoices found.</div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 border-t border-[var(--os-border)] text-[10px] text-[var(--os-text-muted)]">
                        Showing 1–{filtered.length} of {mockTransactions.length} invoices
                    </div>
                </div>

                {/* Right detail */}
                <div className="flex-1 overflow-y-auto">
                    {selected ? (
                        <InvoiceDetail
                            tx={selected}
                            onGenerateProForma={() => setProForma(selected)}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-[var(--os-text-muted)] text-sm">
                            Select an invoice to view details
                        </div>
                    )}
                </div>
            </div>

            {/* Pro-forma modal */}
            {proForma && <ProFormaModal tx={proForma} onClose={() => setProForma(null)} />}
        </div>
    );
}

// ── Invoice Detail Panel ──────────────────────────────────────────────────────

function InvoiceDetail({ tx, onGenerateProForma }: { tx: Transaction; onGenerateProForma: () => void }) {
    const [activeTab, setActiveTab] = React.useState<'details' | 'payment' | 'audit'>('details');
    const invoiceRef = `INV-2025-${tx.id.split('-')[1].toUpperCase()}`;
    const isOverdue  = tx.status === TransactionStatus.OVERDUE;
    const isPaid     = tx.status === TransactionStatus.PAID;

    // Simple fee breakdown based on total
    const containerFee = Math.round(tx.taxAmountUsd * 0.75);
    const portCallFee  = Math.round(tx.taxAmountUsd * 0.20);
    const securityFee  = tx.taxAmountUsd - containerFee - portCallFee;

    return (
        <div className="p-5 flex flex-col gap-4">
            {/* Invoice header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-[var(--os-text-primary)]">{invoiceRef}</span>
                        <OsBadge variant={transactionVariant(tx.status)} label={STATUS_LABEL[tx.status]} />
                    </div>
                    <p className="text-xs text-[var(--os-text-muted)]">
                        Issued to <span className="text-[var(--os-text-secondary)] font-medium">{tx.vesselName}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <OsButton variant="secondary" size="sm" icon={<FileText className="w-3.5 h-3.5" />} onClick={onGenerateProForma}>
                        Generate Statement
                    </OsButton>
                    {!isPaid && (
                        <OsButton variant="primary" size="sm" icon={<CheckCircle className="w-3.5 h-3.5" />}>
                            Record Payment
                        </OsButton>
                    )}
                </div>
            </div>

            {/* Port gate alert */}
            {isOverdue && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                    <div>
                        <p className="text-xs font-bold text-[#EF4444]">Port Gate Locked</p>
                        <p className="text-[10px] text-[var(--os-text-muted)]">Payment clearance required for departure.</p>
                    </div>
                    <button className="ml-auto text-[10px] font-bold text-[#EF4444] border border-[#EF4444]/30 px-2 py-1 rounded-lg hover:bg-[rgba(239,68,68,0.1)] transition-colors">
                        Override
                    </button>
                </div>
            )}

            {/* Tabs */}
            <div className="flex items-center gap-0.5 border-b border-[var(--os-border)] pb-0">
                {(['details', 'payment', 'audit'] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setActiveTab(t)}
                        className={`px-4 py-2 text-xs font-semibold capitalize transition-colors border-b-2 -mb-px ${
                            activeTab === t
                                ? 'border-[#00D97E] text-[#00D97E]'
                                : 'border-transparent text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]'
                        }`}
                    >
                        {t === 'audit' ? 'Audit Trail' : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            {activeTab === 'details' && (
                <div className="os-card p-5">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-4">Invoice Summary</h4>
                    <div className="flex flex-col gap-2 mb-4">
                        {[
                            { label: 'Container Fee (190 TEU)', amount: containerFee },
                            { label: 'Port Call Fixed Fee',      amount: portCallFee },
                            { label: 'Maritime Security Surcharge', amount: securityFee },
                        ].map(({ label, amount }) => (
                            <div key={label} className="flex justify-between text-sm py-1 border-b border-[var(--os-border)] last:border-0">
                                <span className="text-[var(--os-text-secondary)]">{label}</span>
                                <span className="font-mono font-medium text-[var(--os-text-primary)]">${amount.toLocaleString()}.00</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-between items-center pt-2">
                        <span className="text-sm font-bold text-[var(--os-text-primary)]">Total Due</span>
                        <span className="text-xl font-bold text-[#00D97E] tabular-nums">${tx.taxAmountUsd.toLocaleString()}.00</span>
                    </div>
                </div>
            )}

            {activeTab === 'payment' && (
                <div className="flex flex-col gap-3">
                    <div className="os-card p-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">Payment Capture</h4>
                        {[
                            { label: 'Dahabshiil / Premier Bank', sub: 'Direct API settlement', badge: 'LIVE', badgeColor: '#00D97E' },
                            { label: 'SWIFT Proof Upload',         sub: 'External wire verification', badge: null, badgeColor: '' },
                            { label: 'Manual Clearance',           sub: 'Dual-Approval Protocol',   badge: 'ADV. PREF+', badgeColor: '#F59E0B' },
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
                <div className="os-card p-5">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-4">Audit Trail</h4>
                    <div className="flex flex-col gap-3">
                        {[
                            { label: 'Invoice Created',         sub: 'by System Automation',                    time: '10:41 UTC', color: '#00D97E' },
                            { label: 'Sent to Agent',           sub: `to operations@${tx.vesselName.toLowerCase().replace(' ', '')}.com`, time: '10:48 UTC', color: '#38BDF8' },
                            { label: 'Viewed by Recipient',     sub: 'IP: 192.168.43.21 (Dubai)',                time: '11:13 UTC', color: '#F59E0B' },
                        ].map(({ label, sub, time, color }) => (
                            <div key={label} className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: `${color}14` }}>
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs font-semibold text-[var(--os-text-primary)]">{label}</p>
                                    <p className="text-[10px] text-[var(--os-text-muted)]">{sub}</p>
                                </div>
                                <span className="text-[10px] text-[var(--os-text-muted)] flex-shrink-0">{time}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Pro-forma CTA */}
            <OsButton
                variant="primary"
                size="md"
                icon={<FileText className="w-4 h-4" />}
                onClick={onGenerateProForma}
                className="w-full"
            >
                Generate Pro-forma Invoice (PDF)
            </OsButton>
        </div>
    );
}
