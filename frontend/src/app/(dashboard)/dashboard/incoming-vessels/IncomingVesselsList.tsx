'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge } from '@/components/ui/OsBadge';
import type { ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';
import { ClaimAlertDialog } from './ClaimAlertDialog';

interface Props {
    alerts: ArrivalAlertWithVessel[];
}

export function IncomingVesselsList({ alerts }: Props) {
    const t = useTranslations('IncomingVessels');
    const [claimTarget, setClaimTarget] = React.useState<ArrivalAlertWithVessel | null>(null);

    const columns: OsColumn<ArrivalAlertWithVessel>[] = [
        {
            key: 'vessel',
            header: t('col.vessel'),
            render: (a) => (
                <span className="font-medium text-[var(--os-text-primary)]">{a.vessel?.name ?? '—'}</span>
            ),
        },
        {
            key: 'imo',
            header: t('col.imo'),
            render: (a) => <span className="font-mono text-xs">{a.imo_number}</span>,
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
            key: 'estimated',
            header: t('col.estimated'),
            render: (a) => (
                <OsBadge
                    variant="approaching"
                    label={a.estimated_route_nm != null ? `${a.estimated_route_nm.toFixed(0)} NM` : '—'}
                />
            ),
        },
        {
            key: 'actions',
            header: t('col.actions'),
            className: 'text-right',
            render: (a) => (
                <div className="flex justify-end">
                    <OsButton size="sm" onClick={() => setClaimTarget(a)}>
                        {t('claim')}
                    </OsButton>
                </div>
            ),
        },
    ];

    return (
        <>
            <OsTable
                columns={columns}
                rows={alerts}
                keyExtractor={(a) => a.id}
                emptyMessage={t('empty')}
            />

            {claimTarget && (
                <ClaimAlertDialog
                    alert={claimTarget}
                    open={!!claimTarget}
                    onClose={() => setClaimTarget(null)}
                />
            )}
        </>
    );
}
