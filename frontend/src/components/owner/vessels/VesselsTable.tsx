'use client';

import * as React from 'react';
import Link from 'next/link';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';

export interface VesselRow {
    id: string;
    /** Référence opaque (mig 147), seule clé admise dans une URL. */
    public_ref: string;
    name: string;
    mmsi: string | null;
    imo_number: string | null;
    flag_code: string;
    category: string;
    last_zone: string | null;
    compliance_status: string;
}

function complianceVariant(status: string): BadgeVariant {
    if (status === 'COMPLIANT') return 'active';
    if (status === 'OVERDUE' || status === 'NON_COMPLIANT') return 'critical';
    if (status === 'APPROACHING' || status === 'PENDING') return 'warning';
    return 'info';
}

interface Props {
    rows: VesselRow[];
    /** Base path for vessel detail links. Defaults to /owner/vessels. */
    vesselBasePath?: string;
}

export function VesselsTable({ rows, vesselBasePath = '/owner/vessels' }: Props) {
    const columns: OsColumn<VesselRow>[] = [
        {
            key: 'name',
            header: 'Vessel',
            render: (r) => (
                <Link
                    href={`${vesselBasePath}/${r.public_ref}`}
                    className="font-medium text-emerald-400 hover:underline"
                >
                    {r.name}
                </Link>
            ),
        },
        {
            key: 'mmsi',
            header: 'MMSI',
            render: (r) => <span className="font-mono text-xs">{r.mmsi ?? '—'}</span>,
        },
        {
            key: 'imo',
            header: 'IMO',
            render: (r) => (
                <span className="font-mono text-xs">{r.imo_number ?? '—'}</span>
            ),
        },
        {
            key: 'flag',
            header: 'Flag',
            render: (r) => (
                <span className="font-mono text-xs uppercase">{r.flag_code}</span>
            ),
        },
        {
            key: 'category',
            header: 'Category',
            render: (r) => <span className="text-xs">{r.category}</span>,
        },
        {
            key: 'lastZone',
            header: 'Last zone',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)]">
                    {r.last_zone ?? '—'}
                </span>
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
            emptyMessage="No vessels linked to your account yet."
        />
    );
}
