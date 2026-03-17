'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsBadge, transactionVariant } from '@/components/ui/OsBadge';
import { useTransactions } from '@/hooks/useTransactions';
import { TransactionType } from '@/types/secure';

const TYPE_ICON: Record<TransactionType, string> = {
    [TransactionType.ENTRY_TAX]:   '\u26A1',
    [TransactionType.TRANSIT_FEE]: '\uD83C\uDF3F',
    [TransactionType.PORT_STAY]:   '\u2693',
};

export function RecentActivitiesTable() {
    const t = useTranslations('Overview');
    const { data: transactions } = useTransactions();

    const TYPE_LABEL: Record<TransactionType, string> = {
        [TransactionType.ENTRY_TAX]:   t('type_carbon_tax'),
        [TransactionType.TRANSIT_FEE]: t('type_transit_fee'),
        [TransactionType.PORT_STAY]:   t('type_port_stay'),
    };

    const STATUS_LABEL: Record<string, string> = {
        PAID: t('status_paid'),
        PENDING: t('status_pending'),
        OVERDUE: t('status_overdue'),
        EXEMPT: t('status_exempt'),
        DISPUTED: t('status_disputed'),
    };

    const columns = [
        t('col_id_reference'),
        t('col_type'),
        t('col_vessel'),
        t('col_status'),
        t('col_amount'),
        t('col_date'),
        t('col_action'),
    ];

    return (
        <div className="os-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--os-border)]">
                <div>
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('recent_activities_title')}</h3>
                    <p className="text-[10px] text-[var(--os-text-muted)]">{t('recent_activities_subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors">
                        <Download className="w-3 h-3" />
                        {t('btn_export')}
                    </button>
                    <a href="/dashboard/invoices" className="text-xs text-[#38BDF8] hover:underline">{t('btn_view_all')}</a>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[var(--os-border)] bg-[var(--os-surface-2)]">
                            {columns.map((h) => (
                                <th key={h} className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] whitespace-nowrap">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {transactions.map((tx) => {
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
                                        <p className="text-[10px] text-[var(--os-text-muted)]">{tx.emissionsTco2} tCO\u2082</p>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className="text-xs text-[var(--os-text-muted)]">{date}</span>
                                    </td>
                                    <td className="px-5 py-3">
                                        <a
                                            href={`/dashboard/invoices?tx=${tx.id}`}
                                            className="text-[10px] font-semibold text-[#38BDF8] hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            {t('btn_view_detail')}
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
