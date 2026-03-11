import * as React from 'react';
import { Download } from 'lucide-react';
import { OsBadge, transactionVariant } from '@/components/ui/OsBadge';
import { mockTransactions } from '@/mock/datas/secureMock';
import { TransactionType } from '@/types/secure';

const TYPE_LABEL: Record<TransactionType, string> = {
    [TransactionType.ENTRY_TAX]:   'Carbon Tax',
    [TransactionType.TRANSIT_FEE]: 'Transit Fee',
    [TransactionType.PORT_STAY]:   'Port Stay',
};

const TYPE_ICON: Record<TransactionType, string> = {
    [TransactionType.ENTRY_TAX]:   '⚡',
    [TransactionType.TRANSIT_FEE]: '🌿',
    [TransactionType.PORT_STAY]:   '⚓',
};

const STATUS_LABEL: Record<string, string> = {
    PAID: 'PAID', PENDING: 'PENDING', OVERDUE: 'OVERDUE', EXEMPT: 'EXEMPT', DISPUTED: 'DISPUTED',
};

export function RecentActivitiesTable() {
    return (
        <div className="os-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--os-border)]">
                <div>
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">Recent Activities</h3>
                    <p className="text-[10px] text-[var(--os-text-muted)]">Latest transactions and events</p>
                </div>
                <div className="flex items-center gap-2">
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors">
                        <Download className="w-3 h-3" />
                        Export
                    </button>
                    <a href="/dashboard/invoices" className="text-xs text-[#38BDF8] hover:underline">View All →</a>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[var(--os-border)] bg-[var(--os-surface-2)]">
                            {['ID Reference', 'Type', 'MSC / Vessel', 'Status', 'Amount / Value', 'Date', 'Action'].map((h) => (
                                <th key={h} className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] whitespace-nowrap">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {mockTransactions.map((tx) => {
                            const date = new Date(tx.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                            return (
                                <tr key={tx.id} className="border-b border-[var(--os-border)] last:border-0 hover:bg-[var(--os-surface-2)] transition-colors cursor-pointer group">
                                    <td className="px-5 py-3">
                                        <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{tx.id.toUpperCase()}</span>
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-2">
                                            <span>{TYPE_ICON[tx.transactionType]}</span>
                                            <span className="text-xs font-medium text-[var(--os-text-primary)]">{TYPE_LABEL[tx.transactionType]}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <p className="text-xs font-semibold text-[var(--os-text-primary)]">{tx.vesselName}</p>
                                        <p className="text-[10px] text-[var(--os-text-muted)]">IMO: {tx.vesselImo}</p>
                                    </td>
                                    <td className="px-5 py-3">
                                        <OsBadge variant={transactionVariant(tx.status)} label={STATUS_LABEL[tx.status]} />
                                    </td>
                                    <td className="px-5 py-3">
                                        <p className="text-xs font-bold text-[var(--os-text-primary)] tabular-nums">
                                            ${tx.taxAmountUsd.toLocaleString('en-US')}
                                        </p>
                                        <p className="text-[10px] text-[var(--os-text-muted)]">{tx.emissionsTco2} tCO₂</p>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className="text-xs text-[var(--os-text-muted)]">{date}</span>
                                    </td>
                                    <td className="px-5 py-3">
                                        <a
                                            href={`/dashboard/invoices?tx=${tx.id}`}
                                            className="text-[10px] font-semibold text-[#38BDF8] hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            View →
                                        </a>
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
