'use client';

import { useTranslations } from 'next-intl';

interface DashboardErrorProps {
    error: Error & { digest?: string };
    reset: () => void;
}

/**
 * Next.js error boundary for the dashboard layout children slot.
 * The sidebar remains visible — this replaces only the <main> content area.
 */
export default function DashboardError({ reset }: DashboardErrorProps) {
    const t = useTranslations('DashboardError');

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
            <div
                className="rounded-xl border p-8 max-w-md w-full flex flex-col gap-4"
                style={{
                    backgroundColor: 'var(--os-surface-2)',
                    borderColor: 'var(--os-border)',
                }}
            >
                <h2
                    className="text-lg font-semibold"
                    style={{ color: 'var(--os-text-primary)' }}
                >
                    {t('title')}
                </h2>
                <p
                    className="text-sm"
                    style={{ color: 'var(--os-text-muted)' }}
                >
                    {t('jurisdictionHint')}
                </p>
                <button
                    onClick={reset}
                    className="self-start rounded-lg px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#00D97E' }}
                >
                    {t('retry')}
                </button>
            </div>
        </div>
    );
}
