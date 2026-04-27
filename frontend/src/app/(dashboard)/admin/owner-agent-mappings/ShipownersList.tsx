'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsInput } from '@/components/ui/OsInput';
import * as Dialog from '@radix-ui/react-dialog';
import { inviteShipowner } from '@/actions/inviteShipowner';
import type { ShipownerListRow } from '@/services/shipownerService';

interface Props {
    shipowners: ShipownerListRow[];
    canInvite: boolean;
}

export function ShipownersList({ shipowners, canInvite }: Props) {
    const t = useTranslations('AdminMappings');
    const router = useRouter();

    const [target, setTarget] = React.useState<ShipownerListRow | null>(null);
    const [email, setEmail] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [isPending, startTransition] = React.useTransition();

    function openInvite(row: ShipownerListRow) {
        setTarget(row);
        setEmail(row.official_email ?? '');
        setError(null);
    }

    function close() {
        setTarget(null);
        setEmail('');
        setError(null);
    }

    function submit() {
        if (!target) return;
        setError(null);
        startTransition(async () => {
            const result = await inviteShipowner({ shipownerId: target.id, email });
            if (!result.ok) {
                setError(result.reason);
                return;
            }
            close();
            router.refresh();
        });
    }

    const stateBadge = (state: ShipownerListRow['account_state']) => {
        if (state === 'ACTIVE') return <OsBadge variant="active" label={t('state.active')} />;
        if (state === 'INVITED') return <OsBadge variant="warning" label={t('state.invited')} />;
        return <OsBadge variant="archived" label={t('state.ghost')} />;
    };

    const columns: OsColumn<ShipownerListRow>[] = [
        {
            key: 'name',
            header: t('col.shipowner'),
            render: (r) => (
                <span className="font-medium text-[var(--os-text-primary)]">{r.name}</span>
            ),
        },
        {
            key: 'imo',
            header: 'IMO #',
            render: (r) => <span className="font-mono text-xs">{r.imo_company_no ?? '—'}</span>,
        },
        {
            key: 'email',
            header: t('col.email'),
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)]">
                    {r.official_email ?? '—'}
                </span>
            ),
        },
        {
            key: 'state',
            header: t('col.portalState'),
            render: (r) => stateBadge(r.account_state),
        },
        {
            key: 'actions',
            header: t('col.actions'),
            className: 'text-right',
            render: (r) =>
                canInvite && r.account_state !== 'ACTIVE' ? (
                    <div className="flex justify-end">
                        <OsButton size="sm" variant="primary" onClick={() => openInvite(r)}>
                            {r.account_state === 'INVITED' ? t('reinvite') : t('invite')}
                        </OsButton>
                    </div>
                ) : null,
        },
    ];

    return (
        <>
            <OsTable
                columns={columns}
                rows={shipowners}
                keyExtractor={(r) => r.id}
                emptyMessage={t('emptyShipowners')}
            />

            <Dialog.Root open={target !== null} onOpenChange={(o) => !o && close()}>
                <Dialog.Portal>
                    <Dialog.Overlay
                        className="fixed inset-0 z-50"
                        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                    />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{
                            backgroundColor: 'var(--os-surface-2)',
                            border: '1px solid var(--os-border)',
                        }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('inviteDialogTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {t('inviteDialogSubtitle', { name: target?.name ?? '' })}
                        </Dialog.Description>

                        <OsInput
                            label={t('col.email')}
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="owner@example.com"
                            autoFocus
                            error={error ?? undefined}
                        />

                        <div className="mt-5 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={close} disabled={isPending}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton
                                variant="primary"
                                onClick={submit}
                                loading={isPending}
                                disabled={isPending || !email}
                            >
                                {isPending ? t('sending') : t('sendInvite')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
}
