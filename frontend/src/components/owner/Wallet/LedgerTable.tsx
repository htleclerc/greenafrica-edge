'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import type { LedgerRow, LedgerKind } from '@/services/walletService';

const KIND_VARIANT: Record<LedgerKind, BadgeVariant> = {
    TOPUP: 'active',
    OVERPAYMENT_CREDIT: 'active',
    REFUND_CREDIT: 'active',
    PROFORMA_APPLY: 'archived',
    ADMIN_ADJUSTMENT: 'warning',
    FX_DIFFERENCE: 'info',
};

const ALL_KINDS: LedgerKind[] = ['TOPUP','OVERPAYMENT_CREDIT','REFUND_CREDIT','PROFORMA_APPLY','ADMIN_ADJUSTMENT','FX_DIFFERENCE'];

interface Props {
    rows: LedgerRow[];
    onFilterChange: (kinds: LedgerKind[]) => void;
    activeFilters: LedgerKind[];
}

export function LedgerTable({ rows, onFilterChange, activeFilters }: Props) {
    const t = useTranslations('OwnerPortal.wallet.ledger');

    function toggleKind(k: LedgerKind) {
        const next = activeFilters.includes(k)
            ? activeFilters.filter((x) => x !== k)
            : [...activeFilters, k];
        onFilterChange(next);
    }

    const columns: OsColumn<LedgerRow>[] = [
        {
            key: 'date',
            header: t('col.date'),
            render: (r) => <span className="text-xs tabular-nums">{new Date(r.created_at).toLocaleDateString()}</span>,
        },
        {
            key: 'amount',
            header: t('col.amount'),
            className: 'text-right',
            render: (r) => {
                const isPositive = r.amount_signed_usd_minor > 0;
                const dollars = Math.abs(r.amount_signed_usd_minor) / 100;
                return (
                    <span
                        className="font-mono text-sm tabular-nums"
                        style={{ color: isPositive ? '#10B981' : '#F59E0B' }}
                    >
                        {isPositive ? '+' : '−'}${dollars.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                );
            },
        },
        {
            key: 'kind',
            header: t('col.kind'),
            render: (r) => <OsBadge variant={KIND_VARIANT[r.kind]} label={t(`kind.${r.kind}`)} />,
        },
        {
            key: 'justification',
            header: t('col.note'),
            render: (r) => <span className="text-xs text-[var(--os-text-muted)]">{r.justification ?? '—'}</span>,
        },
    ];

    return (
        <section className="os-card p-5">
            <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('title')}</h2>
                <div className="flex flex-wrap gap-1">
                    {ALL_KINDS.map((k) => {
                        const active = activeFilters.includes(k);
                        return (
                            <button
                                key={k}
                                onClick={() => toggleKind(k)}
                                className="text-[10px] font-mono px-2 py-0.5 rounded-md border"
                                style={{
                                    borderColor: active ? '#10B981' : 'var(--os-border)',
                                    backgroundColor: active ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                    color: active ? '#10B981' : 'var(--os-text-muted)',
                                }}
                            >
                                {k}
                            </button>
                        );
                    })}
                </div>
            </header>
            <OsTable columns={columns} rows={rows} keyExtractor={(r) => r.id} emptyMessage={t('empty')} />
        </section>
    );
}
