'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';

export interface OwnerDisputeRow {
    id: string;
    ref: string;
    vesselName: string;
    status: 'OPEN' | 'UNDER_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'ESCALATED';
    originalAmountUsd: number;
    createdAt: string;
}

const STATUS_VARIANT: Record<OwnerDisputeRow['status'], BadgeVariant> = {
    OPEN: 'warning',
    UNDER_REVIEW: 'info',
    ACCEPTED: 'active',
    REJECTED: 'critical',
    ESCALATED: 'critical',
};

export function OwnerDisputesList({ rows }: { rows: OwnerDisputeRow[] }) {
    const t = useTranslations('OwnerPortal.disputes');

    if (rows.length === 0) {
        return (
            <div className="os-card p-8 text-center text-sm text-[var(--os-text-muted)]">
                {t('empty')}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {rows.map((d) => (
                <div key={d.id} className="os-card p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-[var(--os-text-muted)]">{d.ref}</span>
                            <OsBadge variant={STATUS_VARIANT[d.status]} label={d.status} size="sm" />
                        </div>
                        <p className="text-sm font-medium text-[var(--os-text-primary)] truncate mt-0.5">{d.vesselName}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold tabular-nums text-[var(--os-text-primary)]">
                            ${d.originalAmountUsd.toLocaleString()}
                        </p>
                        <p className="text-[10px] text-[var(--os-text-muted)]">
                            {new Date(d.createdAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
}
