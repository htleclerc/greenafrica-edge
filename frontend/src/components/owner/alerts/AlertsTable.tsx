'use client';

import * as React from 'react';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';

export interface AlertRow {
    id: string;
    status: string;
    detected_at: string;
    distance_to_port_nm: number | null;
    estimated_route_nm: number | null;
    vessel: { id: string; name: string; imo_number: string } | null;
}

const STATUS_ORDER = [
    'DETECTED',
    'MATCHED_AUTO',
    'UNCLAIMED',
    'PROFORMA_SENT',
    'ARRIVED',
    'DEPARTED_EEZ',
    'RECONCILED',
    'ESCALATED',
    'CANCELLED',
];

function statusVariant(status: string): BadgeVariant {
    if (status === 'RECONCILED') return 'active';
    if (status === 'ESCALATED' || status === 'UNCLAIMED') return 'critical';
    if (status === 'PROFORMA_SENT' || status === 'ARRIVED' || status === 'DEPARTED_EEZ') return 'warning';
    if (status === 'CANCELLED') return 'archived';
    return 'info';
}

interface Props {
    rows: AlertRow[];
    emptyMessage: string;
}

export function AlertsTable({ rows, emptyMessage }: Props) {
    const columns: OsColumn<AlertRow>[] = [
        {
            key: 'vessel',
            header: 'Vessel',
            render: (r) => (
                <div className="flex flex-col leading-tight">
                    <span className="font-medium text-[var(--os-text-primary)]">
                        {r.vessel?.name ?? '—'}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--os-text-muted)]">
                        IMO {r.vessel?.imo_number ?? '—'}
                    </span>
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            render: (r) => <OsBadge variant={statusVariant(r.status)} label={r.status} />,
        },
        {
            key: 'progress',
            header: 'Progress',
            render: (r) => {
                const idx = STATUS_ORDER.indexOf(r.status);
                const pct = idx >= 0 ? Math.round(((idx + 1) / 7) * 100) : 0;
                return (
                    <div
                        className="w-24 h-1.5 rounded-full overflow-hidden"
                        style={{ backgroundColor: 'var(--os-border)' }}
                    >
                        <div
                            className="h-full"
                            style={{ width: `${pct}%`, backgroundColor: '#10B981' }}
                        />
                    </div>
                );
            },
        },
        {
            key: 'distance',
            header: 'Distance',
            className: 'text-right',
            render: (r) => (
                <span className="font-mono text-xs tabular-nums">
                    {r.distance_to_port_nm
                        ? `${Math.round(Number(r.distance_to_port_nm))} NM`
                        : '—'}
                </span>
            ),
        },
        {
            key: 'detected',
            header: 'Detected',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                    {new Date(r.detected_at).toLocaleString()}
                </span>
            ),
        },
    ];

    return (
        <OsTable
            columns={columns}
            rows={rows}
            keyExtractor={(r) => r.id}
            emptyMessage={emptyMessage}
        />
    );
}
