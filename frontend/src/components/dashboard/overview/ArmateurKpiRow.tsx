'use client';

import * as React from 'react';
import { DollarSign, Anchor, TrendingUp, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsStatCard } from '@/components/ui/OsStatCard';
import type { ArmateurKpis } from '@/types/secure';

/**
 * Vertical-stack armateur KPI column. Intentionally 1×4, not the 4×1 grid used
 * by staff — the armateur dashboard uses this as the right-hand companion to
 * NextPaymentCard (2/3 + 1/3 grid), so stats read top-down inside the column.
 *
 * Stats priority (top → bottom):
 *   1. outstanding_total — current debt, most decision-critical
 *   2. vessels_active    — fleet scale context
 *   3. tax_paid_ytd      — YTD relationship / compliance history
 *   4. overdue_count     — alert stat, highlight-border when > 0
 */
interface ArmateurKpiRowProps {
    kpis: ArmateurKpis;
    loading?: boolean;
}

export function ArmateurKpiRow({ kpis, loading = false }: ArmateurKpiRowProps) {
    const t = useTranslations('ArmateurKpiRow');

    if (loading) {
        return (
            <div className="grid grid-cols-1 gap-3">
                {[0, 1, 2, 3].map((i) => (
                    <div
                        key={i}
                        className="os-card p-4 h-[86px] animate-pulse bg-[var(--os-surface-2)]"
                    />
                ))}
            </div>
        );
    }

    const outstandingValue = kpis.outstandingTotalUsd.toLocaleString('en-US', {
        maximumFractionDigits: 0,
    });
    const paidValue = kpis.taxPaidYtdUsd.toLocaleString('en-US', {
        maximumFractionDigits: 0,
    });

    return (
        <div className="grid grid-cols-1 gap-3">
            <OsStatCard
                label={t('outstanding_label')}
                value={`$${outstandingValue}`}
                icon={<DollarSign className="w-4 h-4" />}
            />
            <OsStatCard
                label={t('vessels_active_label')}
                value={String(kpis.vesselsActive)}
                icon={<Anchor className="w-4 h-4" />}
            />
            <OsStatCard
                label={t('paid_ytd_label')}
                value={`$${paidValue}`}
                icon={<TrendingUp className="w-4 h-4" />}
            />
            <OsStatCard
                label={t('overdue_label')}
                value={String(kpis.overdueCount)}
                icon={<AlertCircle className="w-4 h-4" />}
                highlight={kpis.overdueCount > 0}
            />
        </div>
    );
}
