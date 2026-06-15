'use client';

// Client wrapper that renders ShippingAgentView directly for operator principals.
// This bypasses TcoDashboard's useRole() check (which would resolve 'SHIPOWNER'
// from profiles instead of 'SHIPPING_AGENT', causing operators to see the wrong view).
// Keeping it client-only matches TcoDashboard / ShippingAgentView which are already client.

import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { ShippingAgentView } from '@/components/dashboard/tco/TcoDashboard';

export function OperatorTcoPage() {
    const t = useTranslations('TCO');

    return (
        <div className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-5">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
                    <p className="text-xs text-[var(--os-text-muted)] mt-0.5">{t('subtitle')}</p>
                </div>
                <OsButton
                    variant="secondary"
                    size="sm"
                    icon={<Download className="w-3.5 h-3.5" />}
                    onClick={() => alert('CSV export coming soon')}
                >
                    {t('export_csv')}
                </OsButton>
            </div>
            <ShippingAgentView />
        </div>
    );
}
