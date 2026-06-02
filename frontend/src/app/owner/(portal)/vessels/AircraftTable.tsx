'use client';

import * as React from 'react';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { ModeBadge } from '@/components/owner/ModeBadge';

export interface AircraftRow {
    id: string;
    icao24: string | null;
    registration: string | null;
    icao_type: string | null;
    engine_type: string | null;
    compliance_status: string;
}

function complianceVariant(status: string): BadgeVariant {
    if (status === 'COMPLIANT') return 'active';
    if (status === 'OVERDUE' || status === 'NON_COMPLIANT') return 'critical';
    if (status === 'APPROACHING' || status === 'PENDING') return 'warning';
    return 'info';
}

interface Props {
    rows: AircraftRow[];
}

export function AircraftTable({ rows }: Props) {
    const columns: OsColumn<AircraftRow>[] = [
        {
            key: 'registration',
            header: 'Aircraft',
            render: (r) => (
                <span className="inline-flex items-center gap-2">
                    <span className="font-medium text-[var(--os-text-primary)]">
                        {r.registration ?? '—'}
                    </span>
                    <ModeBadge mode="AIR" />
                </span>
            ),
        },
        {
            key: 'icao24',
            header: 'ICAO24',
            render: (r) => <span className="font-mono text-xs uppercase">{r.icao24 ?? '—'}</span>,
        },
        {
            key: 'type',
            header: 'Type',
            render: (r) => <span className="font-mono text-xs">{r.icao_type ?? '—'}</span>,
        },
        {
            key: 'engine',
            header: 'Engine',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)]">{r.engine_type ?? '—'}</span>
            ),
        },
        {
            key: 'compliance',
            header: 'Compliance',
            render: (r) => (
                <OsBadge
                    variant={complianceVariant(r.compliance_status)}
                    label={r.compliance_status}
                />
            ),
        },
    ];

    return (
        <OsTable
            columns={columns}
            rows={rows}
            keyExtractor={(r) => r.id}
            emptyMessage="No aircraft linked to your account yet."
        />
    );
}
