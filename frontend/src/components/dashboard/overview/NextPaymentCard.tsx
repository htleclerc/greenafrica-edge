'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useArmateurNextPayment } from '@/hooks/useArmateurNextPayment';

// 30-day window for the client-side pseudo-due-date. Mirrors getArmateurKpis
// OVERDUE_DAYS and the PR-2 NET-30 design. Will be replaced by the stored
// due_date column once PR-2 lands.
const DUE_WINDOW_DAYS = 30;

function addDays(iso: string, days: number): Date {
    return new Date(new Date(iso).getTime() + days * 86400000);
}

function daysUntil(target: Date): number {
    const msPerDay = 86400000;
    const diff = target.getTime() - Date.now();
    return Math.ceil(diff / msPerDay);
}

/**
 * Color ramp for the days-remaining visual anchor:
 *   > 15d   → neutral white (calm)
 *   5-15d   → neutral white (still calm)
 *   1-5d    → yellow  (act soon)
 *   ≤ 0d    → red     (overdue)
 */
function daysRampClass(days: number): string {
    if (days <= 0) return 'text-[var(--os-red)]';
    if (days <= 5) return 'text-[var(--ais-yellow)]';
    return 'text-[var(--os-text-primary)]';
}

/**
 * Armateur home widget — dominant 2/3-width card showing the next upcoming
 * payment. Empty state ("Compte à jour") is a deliberate reward, not a dead
 * zone. The entire card is a link affordance; CTA text remains visible as a
 * visual cue but is not a separate click target.
 */
export function NextPaymentCard() {
    const { data: tx, loading } = useArmateurNextPayment();
    const t = useTranslations('NextPaymentCard');

    if (loading) {
        return (
            <div className="os-card p-6 min-h-[180px] flex flex-col gap-4">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                    {t('label')}
                </div>
                <div className="h-16 w-24 rounded bg-[var(--os-surface-2)] animate-pulse" />
                <div className="h-4 w-48 rounded bg-[var(--os-surface-2)] animate-pulse" />
            </div>
        );
    }

    // Empty state — rewarded + action-oriented CTA.
    if (!tx) {
        return (
            <Link
                href="/dashboard/simulator"
                className="os-card p-6 min-h-[180px] flex flex-col justify-center items-center gap-3 text-center
                           hover:bg-[var(--os-surface-2)] transition-colors duration-150"
            >
                <CheckCircle2
                    className="w-10 h-10 text-[var(--os-brand-green)]"
                    aria-hidden="true"
                />
                <div>
                    <div className="text-base font-semibold text-[var(--os-text-primary)]">
                        {t('empty_title')}
                    </div>
                    <div className="text-xs text-[var(--os-text-muted)] mt-1">
                        {t('empty_sub')}
                    </div>
                </div>
                <div className="flex items-center gap-1 text-xs font-medium text-[var(--os-brand-green)]">
                    {t('empty_cta')}
                    <ArrowRight className="w-3.5 h-3.5" />
                </div>
            </Link>
        );
    }

    const dueDate = addDays(tx.createdAt, DUE_WINDOW_DAYS);
    const days = daysUntil(dueDate);
    const rampClass = daysRampClass(days);
    const absDays = Math.abs(days);
    const daysLabel =
        days <= 0
            ? t('overdue_caption', { count: absDays })
            : t('days_caption', { count: days });

    return (
        <Link
            href={`/dashboard/invoices?focus=${encodeURIComponent(tx.id)}`}
            className="os-card p-6 min-h-[180px] flex flex-col gap-4
                       hover:bg-[var(--os-surface-2)] transition-colors duration-150"
        >
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                {t('label')}
            </div>

            <div className="flex items-baseline gap-3">
                <span
                    className={`text-[64px] font-bold leading-none tabular-nums ${rampClass}`}
                    aria-label={daysLabel}
                >
                    {absDays}
                </span>
                <span className="text-sm text-[var(--os-text-muted)] uppercase tracking-wider">
                    {daysLabel}
                </span>
            </div>

            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-0.5">
                    <span className="text-lg font-bold text-[var(--os-text-primary)] tabular-nums">
                        ${tx.taxAmountUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-xs text-[var(--os-text-secondary)]">
                        {tx.vesselName}
                    </span>
                </div>
                <div className="flex items-center gap-1 text-xs font-medium text-[var(--os-brand-green)]">
                    {t('cta')}
                    <ArrowRight className="w-3.5 h-3.5" />
                </div>
            </div>
        </Link>
    );
}
