'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { createOwnerDispute } from '@/actions/createOwnerDispute';

const REASON_OPTIONS = [
    { value: 'EMISSION_CALCULATION', label: 'Emission calculation' },
    { value: 'TAX_RATE', label: 'Tax rate' },
    { value: 'ZONE_CLASSIFICATION', label: 'Zone classification' },
    { value: 'VESSEL_DATA', label: 'Vessel data' },
    { value: 'OTHER', label: 'Other' },
] as const;

type Reason = (typeof REASON_OPTIONS)[number]['value'];

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    transactionId: string;
    invoiceRef: string;
}

export function OpenDisputeDialog({ open, onOpenChange, transactionId, invoiceRef }: Props) {
    const router = useRouter();
    const [reason, setReason] = React.useState<Reason | ''>('');
    const [description, setDescription] = React.useState('');
    const [evidenceUrl, setEvidenceUrl] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [isPending, startTransition] = React.useTransition();

    React.useEffect(() => {
        if (open) {
            setReason('');
            setDescription('');
            setEvidenceUrl('');
            setError(null);
        }
    }, [open]);

    const canSubmit = reason !== '' && description.trim().length >= 10 && !isPending;

    function submit() {
        if (!canSubmit) return;
        setError(null);
        startTransition(async () => {
            const result = await createOwnerDispute({
                transactionId,
                reason: reason as Reason,
                description,
                evidenceUrl,
            });
            if (!result.ok) {
                setError(result.reason);
                return;
            }
            onOpenChange(false);
            router.refresh();
        });
    }

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className="fixed inset-0 z-50"
                    style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{
                        backgroundColor: 'var(--os-surface-2)',
                        border: '1px solid var(--os-border)',
                    }}
                >
                    <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                        Dispute charge
                    </Dialog.Title>
                    <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                        Open a dispute on{' '}
                        <span className="font-mono text-emerald-400">{invoiceRef}</span>. Port
                        Operations will review and respond by email.
                    </Dialog.Description>

                    <div className="flex flex-col gap-3">
                        <div>
                            <label className="block text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                                Reason
                            </label>
                            <select
                                value={reason}
                                onChange={(e) => setReason(e.target.value as Reason)}
                                className="w-full px-3 py-2 rounded-lg text-sm"
                                style={{
                                    backgroundColor: 'var(--os-surface)',
                                    border: '1px solid var(--os-border)',
                                    color: 'var(--os-text-primary)',
                                }}
                            >
                                <option value="">Select a reason…</option>
                                {REASON_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                                Description ({description.trim().length}/10+)
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={4}
                                placeholder="Explain why you believe this assessment is incorrect…"
                                className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                                style={{
                                    backgroundColor: 'var(--os-surface)',
                                    border: '1px solid var(--os-border)',
                                    color: 'var(--os-text-primary)',
                                }}
                            />
                        </div>

                        <OsInput
                            label="Evidence URL (optional)"
                            value={evidenceUrl}
                            onChange={(e) => setEvidenceUrl(e.target.value)}
                            placeholder="https://..."
                            error={error ?? undefined}
                        />
                    </div>

                    <div className="mt-5 flex justify-end gap-2">
                        <OsButton
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={isPending}
                        >
                            Cancel
                        </OsButton>
                        <OsButton
                            variant="primary"
                            onClick={submit}
                            loading={isPending}
                            disabled={!canSubmit}
                        >
                            {isPending ? 'Submitting…' : 'Open dispute'}
                        </OsButton>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
