'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import type { EscalatedAlert } from '@/services/escalationService';

interface Props {
    rows: EscalatedAlert[];
}

function formatRelativeTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function UnclaimedPanel({ rows }: Props) {
    const t = useTranslations('AdminEscalations.unclaimed');

    const columns: OsColumn<EscalatedAlert>[] = [
        {
            key: 'vessel',
            header: t('col.vessel'),
            render: (a) => (
                <span className="font-medium text-[var(--os-text-primary)]">
                    {a.vessel?.name ?? '—'}
                </span>
            ),
        },
        {
            key: 'imo',
            header: t('col.imo'),
            render: (a) => <span className="font-mono text-xs">{a.imo_number}</span>,
        },
        {
            key: 'detectedAgo',
            header: t('col.detectedAgo'),
            render: (a) => <span className="text-xs">{formatRelativeTime(a.detected_at)}</span>,
        },
        {
            key: 'distance',
            header: t('col.distance'),
            render: (a) => `${a.distance_to_port_nm.toFixed(0)} NM`,
        },
        {
            key: 'eta',
            header: t('col.eta'),
            render: (a) => (a.estimated_eta ? new Date(a.estimated_eta).toLocaleString() : '—'),
        },
        {
            key: 'actions',
            header: t('col.actions'),
            className: 'text-right',
            render: () => (
                <div className="flex justify-end">
                    <OsButton
                        size="sm"
                        variant="secondary"
                        disabled
                        title={t('assignComingSoon')}
                    >
                        {t('assign')}
                    </OsButton>
                </div>
            ),
        },
    ];

    return (
        <OsTable
            columns={columns}
            rows={rows}
            keyExtractor={(a) => a.id}
            emptyMessage={t('empty')}
        />
    );
}
