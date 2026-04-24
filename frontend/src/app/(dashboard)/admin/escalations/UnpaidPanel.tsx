'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge } from '@/components/ui/OsBadge';
import type { UnpaidProforma } from '@/services/escalationService';
import { EscalateDialog } from './EscalateDialog';

interface Props {
    rows: UnpaidProforma[];
}

function daysOverdue(arrivedAt: string | null): number {
    if (!arrivedAt) return 0;
    return Math.floor((Date.now() - new Date(arrivedAt).getTime()) / 86_400_000);
}

function sourceBadgeVariant(
    source: UnpaidProforma['shipownerOfficialEmailSource'],
): 'compliant' | 'info' | 'pending' | 'archived' {
    switch (source) {
        case 'EQUASIS_VERIFIED':
            return 'compliant';
        case 'AGENT_CLAIM':
            return 'info';
        case 'PORT_OFFICER':
            return 'pending';
        default:
            return 'archived';
    }
}

export function UnpaidPanel({ rows }: Props) {
    const t = useTranslations('AdminEscalations.unpaid');
    const [target, setTarget] = React.useState<UnpaidProforma | null>(null);

    const columns: OsColumn<UnpaidProforma>[] = [
        {
            key: 'vessel',
            header: t('col.vessel'),
            render: (r) => (
                <span className="font-medium text-[var(--os-text-primary)]">{r.vesselName}</span>
            ),
        },
        {
            key: 'imo',
            header: t('col.imo'),
            render: (r) => <span className="font-mono text-xs">{r.vesselImo}</span>,
        },
        {
            key: 'ref',
            header: t('col.ref'),
            render: (r) => (
                <span className="font-mono text-xs text-[var(--os-text-secondary)]">
                    {r.transactionRef ?? '—'}
                </span>
            ),
        },
        {
            key: 'amount',
            header: t('col.amount'),
            render: (r) => (
                <span className="font-mono">
                    {r.taxAmountUsd.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                    })}
                </span>
            ),
        },
        {
            key: 'arrived',
            header: t('col.arrived'),
            render: (r) => (r.arrivedAt ? new Date(r.arrivedAt).toLocaleDateString() : '—'),
        },
        {
            key: 'overdue',
            header: t('col.overdue'),
            render: (r) => {
                const days = daysOverdue(r.arrivedAt);
                return (
                    <OsBadge
                        variant={days >= 7 ? 'overdue' : 'pending'}
                        label={`${days}d`}
                    />
                );
            },
        },
        {
            key: 'ownerEmail',
            header: t('col.ownerEmail'),
            render: (r) => (
                <div className="flex flex-col gap-1">
                    <span className="text-xs">{r.shipownerOfficialEmail ?? t('noEmail')}</span>
                    <OsBadge
                        variant={sourceBadgeVariant(r.shipownerOfficialEmailSource)}
                        label={r.shipownerOfficialEmailSource ?? '—'}
                        dot={false}
                    />
                </div>
            ),
        },
        {
            key: 'actions',
            header: t('col.actions'),
            className: 'text-right',
            render: (r) => (
                <div className="flex justify-end">
                    <OsButton size="sm" onClick={() => setTarget(r)}>
                        {t('escalate')}
                    </OsButton>
                </div>
            ),
        },
    ];

    return (
        <>
            <OsTable
                columns={columns}
                rows={rows}
                keyExtractor={(r) => r.transactionId}
                emptyMessage={t('empty')}
            />

            {target && (
                <EscalateDialog
                    row={target}
                    open={!!target}
                    onClose={() => setTarget(null)}
                />
            )}
        </>
    );
}
