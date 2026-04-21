'use client';

import * as React from 'react';
import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useRole } from '@/lib/RoleContext';
import { getTransactionsByVessel } from '@/services/transactionService';
import type { Transaction } from '@/types/secure';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, transactionVariant } from '@/components/ui/OsBadge';
import { ProformaActionButton } from '@/components/dashboard/shared/ProformaActionButton';

interface VesselPaymentsTabProps {
    vesselId: string;
}

/**
 * Paiements tab rendered inside the MyFleet slide-over. Fetches transactions
 * for a single vessel_id (sorted DESC by created_at) and renders them via
 * OsTable with a status badge + role-aware ProformaActionButton per row.
 *
 * RLS auto-scopes: a SHIPPING_AGENT only sees their own vessel's tx; staff
 * sees everything. No extra role filtering required.
 */
export function VesselPaymentsTab({ vesselId }: VesselPaymentsTabProps) {
    const { isDemo, ready } = useRole();
    const t = useTranslations('VesselPaymentsTab');
    const [rows, setRows] = React.useState<Transaction[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        if (!ready) return;
        if (isDemo) {
            setRows([]);
            setLoading(false);
            return;
        }
        let cancelled = false;
        const client = createClient();
        setLoading(true);
        getTransactionsByVessel(client, vesselId)
            .then((data) => {
                if (!cancelled) {
                    setRows(data);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [vesselId, isDemo, ready]);

    const columns: OsColumn<Transaction>[] = [
        {
            key: 'date',
            header: t('col_date'),
            render: (tx) => (
                <span className="tabular-nums text-[var(--os-text-secondary)] text-xs">
                    {new Date(tx.createdAt).toLocaleDateString('en-GB', {
                        day: '2-digit', month: 'short', year: 'numeric',
                    })}
                </span>
            ),
        },
        {
            key: 'ref',
            header: t('col_ref'),
            render: (tx) => (
                <span className="font-mono text-xs text-[var(--os-text-primary)]">
                    {tx.ref || '—'}
                </span>
            ),
        },
        {
            key: 'amount',
            header: t('col_amount'),
            className: 'text-right',
            render: (tx) => (
                <span className="tabular-nums font-semibold text-[var(--os-text-primary)]">
                    ${tx.taxAmountUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
            ),
        },
        {
            key: 'status',
            header: t('col_status'),
            render: (tx) => (
                <OsBadge
                    variant={transactionVariant(tx.status)}
                    label={tx.status}
                />
            ),
        },
        {
            key: 'action',
            header: '',
            className: 'text-right',
            render: (tx) => (
                <ProformaActionButton
                    transactionId={tx.id}
                    invoiceRef={tx.invoiceRef}
                    contentHash={tx.contentHash}
                    verifySignature={tx.verifySignature}
                />
            ),
        },
    ];

    if (!loading && rows.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <FileText
                    className="w-10 h-10 text-[var(--os-text-muted)]"
                    aria-hidden="true"
                />
                <div>
                    <div className="text-sm font-semibold text-[var(--os-text-primary)]">
                        {t('empty_title')}
                    </div>
                    <div className="text-xs text-[var(--os-text-muted)] mt-1">
                        {t('empty_sub')}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <OsTable<Transaction>
            columns={columns}
            rows={rows}
            keyExtractor={(tx) => tx.id}
            loading={loading}
            emptyMessage={t('empty_title')}
        />
    );
}
