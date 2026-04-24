'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge } from '@/components/ui/OsBadge';
import type { OwnerAgentMapping } from '@/services/ownerAgentMappingService';
import { deactivateOwnerAgentMapping } from '@/actions/deactivateOwnerAgentMapping';

interface Props {
    mappings: OwnerAgentMapping[];
}

export function OwnerAgentMappingList({ mappings }: Props) {
    const t = useTranslations('AdminMappings');
    const router = useRouter();
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [activeOnly, setActiveOnly] = React.useState(false);
    const [isPending, startTransition] = React.useTransition();

    const visible = React.useMemo(
        () => (activeOnly ? mappings.filter((m) => m.active) : mappings),
        [mappings, activeOnly],
    );

    function handleDeactivate(row: OwnerAgentMapping) {
        setError(null);
        setPendingId(row.id);
        startTransition(async () => {
            const result = await deactivateOwnerAgentMapping({ mappingId: row.id });
            setPendingId(null);
            if (!result.ok) {
                setError(result.reason);
                return;
            }
            router.refresh();
        });
    }

    const columns: OsColumn<OwnerAgentMapping>[] = [
        {
            key: 'shipowner',
            header: t('col.shipowner'),
            render: (r) => (
                <span className="font-medium text-[var(--os-text-primary)]">
                    {r.shipowner_name}
                </span>
            ),
        },
        {
            key: 'agent',
            header: t('col.agent'),
            render: (r) => (
                <span className="text-[var(--os-text-primary)]">{r.agent_name}</span>
            ),
        },
        {
            key: 'priority',
            header: t('col.priority'),
            render: (r) => <span className="font-mono text-xs">{r.priority}</span>,
        },
        {
            key: 'validFrom',
            header: t('col.validFrom'),
            render: (r) => <span className="text-xs">{r.valid_from}</span>,
        },
        {
            key: 'validUntil',
            header: t('col.validUntil'),
            render: (r) => <span className="text-xs">{r.valid_until ?? '—'}</span>,
        },
        {
            key: 'active',
            header: t('col.active'),
            render: (r) =>
                r.active ? (
                    <OsBadge variant="active" label={t('active')} />
                ) : (
                    <OsBadge variant="archived" label={t('deactivated')} />
                ),
        },
        {
            key: 'actions',
            header: t('col.actions'),
            className: 'text-right',
            render: (r) => (
                <div className="flex justify-end">
                    {r.active ? (
                        <OsButton
                            size="sm"
                            variant="danger"
                            onClick={() => handleDeactivate(r)}
                            loading={isPending && pendingId === r.id}
                            disabled={isPending && pendingId === r.id}
                        >
                            {isPending && pendingId === r.id
                                ? t('deactivating')
                                : t('deactivate')}
                        </OsButton>
                    ) : null}
                </div>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <OsButton
                        variant={activeOnly ? 'primary' : 'ghost'}
                        size="sm"
                        onClick={() => setActiveOnly((v) => !v)}
                    >
                        {t('showActiveOnly')}
                    </OsButton>
                </div>
                {error && <p className="text-xs text-[#EF4444]">{error}</p>}
            </div>

            <OsTable
                columns={columns}
                rows={visible}
                keyExtractor={(r) => r.id}
                emptyMessage={t('empty')}
            />
        </div>
    );
}
