'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { createOwnerAgentMapping } from '@/actions/createOwnerAgentMapping';

interface Props {
    shipowners: { id: string; name: string }[];
    agents: { id: string; full_name: string | null; email: string }[];
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

export function AddMappingForm({ shipowners, agents }: Props) {
    const t = useTranslations('AdminMappings.form');
    const router = useRouter();

    const [shipownerId, setShipownerId] = React.useState('');
    const [agentProfileId, setAgentProfileId] = React.useState('');
    const [priority, setPriority] = React.useState<number>(100);
    const [validFrom, setValidFrom] = React.useState<string>(todayIso());
    const [validUntil, setValidUntil] = React.useState<string>('');
    const [error, setError] = React.useState<string | null>(null);
    const [pending, startTransition] = React.useTransition();

    function resetForm() {
        setShipownerId('');
        setAgentProfileId('');
        setPriority(100);
        setValidFrom(todayIso());
        setValidUntil('');
    }

    function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);

        if (!shipownerId) {
            setError(t('shipowner'));
            return;
        }
        if (!agentProfileId) {
            setError(t('agent'));
            return;
        }

        startTransition(async () => {
            const result = await createOwnerAgentMapping({
                shipownerId,
                agentProfileId,
                priority: Number(priority),
                validFrom: validFrom || undefined,
                validUntil: validUntil ? validUntil : null,
            });
            if (!result.ok) {
                setError(result.reason);
                return;
            }
            resetForm();
            router.refresh();
        });
    }

    const shipownerOptions = shipowners.map((s) => ({ value: s.id, label: s.name }));
    const agentOptions = agents.map((a) => ({
        value: a.id,
        label: a.full_name ?? a.email,
    }));

    return (
        <form
            onSubmit={submit}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)]"
        >
            <OsSelect
                label={t('shipowner')}
                placeholder="—"
                options={shipownerOptions}
                value={shipownerId}
                onChange={(e) => setShipownerId(e.target.value)}
                disabled={pending}
            />
            <OsSelect
                label={t('agent')}
                placeholder="—"
                options={agentOptions}
                value={agentProfileId}
                onChange={(e) => setAgentProfileId(e.target.value)}
                disabled={pending}
            />
            <OsInput
                type="number"
                min={1}
                max={1000}
                label={t('priority')}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                disabled={pending}
            />
            <OsInput
                type="date"
                label={t('validFrom')}
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                disabled={pending}
            />
            <OsInput
                type="date"
                label={t('validUntil')}
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                disabled={pending}
            />
            <div className="flex flex-col gap-1.5 justify-end">
                <OsButton type="submit" variant="primary" loading={pending} disabled={pending}>
                    {pending ? t('submitting') : t('submit')}
                </OsButton>
                {error && <p className="text-xs text-[#EF4444]">{error}</p>}
            </div>
        </form>
    );
}
