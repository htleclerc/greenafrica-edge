'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface OverdueBannerProps {
    /** Number of overdue invoices — the banner is hidden when this is 0. */
    overdueCount: number;
    /** Optional total amount overdue; omitted from the copy when undefined. */
    overdueTotalUsd?: number;
}

/**
 * Persistent alert banner shown when overdue_count > 0. Border-red-non-fill
 * to avoid crying-wolf saturation; role="alert" so screen readers announce
 * on arrival. Sticky above the KPI row until resolution (hides itself when
 * overdueCount drops to 0).
 */
export function OverdueBanner({ overdueCount, overdueTotalUsd }: OverdueBannerProps) {
    const t = useTranslations('OverdueBanner');

    if (overdueCount <= 0) return null;

    const totalLabel =
        overdueTotalUsd !== undefined
            ? `$${overdueTotalUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            : '';

    return (
        <div
            role="alert"
            className="os-card p-4 flex items-center justify-between gap-4 flex-wrap
                       border border-[var(--os-red)]/40
                       bg-[var(--os-red)]/5"
        >
            <div className="flex items-start gap-3">
                <AlertCircle
                    className="w-5 h-5 text-[var(--os-red)] mt-0.5 shrink-0"
                    aria-hidden="true"
                />
                <div>
                    <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">
                        {t('title', { count: overdueCount })}
                    </h2>
                    {totalLabel && (
                        <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                            {t('total', { total: totalLabel })}
                        </p>
                    )}
                </div>
            </div>
            <Link
                href="/dashboard/invoices?status=OVERDUE"
                className="inline-flex items-center gap-2 px-4 h-10 rounded-xl
                           bg-[var(--os-red)]/10 hover:bg-[var(--os-red)]/20
                           text-[var(--os-red)] border border-[var(--os-red)]/40
                           text-sm font-semibold transition-colors duration-150
                           focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-[var(--os-red)]"
            >
                {t('cta')}
                <ArrowRight className="w-4 h-4" />
            </Link>
        </div>
    );
}
