'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { WalletDetailDrawer } from './WalletDetailDrawer';

export interface AdminWalletRow {
    wallet_id: string;
    shipowner_id: string;
    shipowner_name: string;
    balance_usd_minor: number;
    auto_apply_to_proforma: boolean;
    last_activity_at: string | null;
}

interface AdminWalletsPanelProps {
    rows: AdminWalletRow[];
}

function formatUsd(minor: number): string {
    return (minor / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
    });
}

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
        });
    } catch {
        return '—';
    }
}

export function AdminWalletsPanel({ rows }: AdminWalletsPanelProps) {
    const t = useTranslations('AdminWallets');
    const router = useRouter();
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [, setRefreshKey] = React.useState(0);

    const columns: OsColumn<AdminWalletRow>[] = React.useMemo(
        () => [
            {
                key: 'owner',
                header: t('col.owner'),
                render: (row) => (
                    <span className="text-sm font-medium text-[var(--os-text-primary)]">
                        {row.shipowner_name}
                    </span>
                ),
            },
            {
                key: 'balance',
                header: t('col.balance'),
                render: (row) => (
                    <span className="font-mono text-sm text-[var(--os-text-primary)]">
                        {formatUsd(row.balance_usd_minor)}
                    </span>
                ),
                className: 'text-right',
            },
            {
                key: 'autoApply',
                header: t('col.autoApply'),
                render: (row) => (
                    <OsBadge
                        variant={row.auto_apply_to_proforma ? 'active' : 'draft'}
                        label={row.auto_apply_to_proforma ? t('autoApply.on') : t('autoApply.off')}
                    />
                ),
            },
            {
                key: 'lastActivity',
                header: t('col.lastActivity'),
                render: (row) => (
                    <span className="text-xs text-[var(--os-text-muted)]">
                        {formatDate(row.last_activity_at)}
                    </span>
                ),
            },
        ],
        [t],
    );

    function handleRefresh() {
        setRefreshKey((k) => k + 1);
        router.refresh();
    }

    return (
        <section className="os-card p-5 mb-5">
            <header className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h2 className="text-lg font-bold text-[var(--os-text-primary)]">{t('title')}</h2>
                    <p className="text-xs text-[var(--os-text-muted)]">{t('subtitle')}</p>
                </div>
                <OsButton
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw className="w-3.5 h-3.5" />}
                    onClick={handleRefresh}
                >
                    {t('refresh')}
                </OsButton>
            </header>

            <OsTable<AdminWalletRow>
                columns={columns}
                rows={rows}
                keyExtractor={(r) => r.wallet_id}
                onRowClick={(r) => setSelectedId(r.wallet_id)}
                emptyMessage={t('empty')}
            />

            {selectedId && (
                <WalletDetailDrawer
                    walletId={selectedId}
                    onClose={() => {
                        setSelectedId(null);
                        router.refresh();
                    }}
                />
            )}
        </section>
    );
}
