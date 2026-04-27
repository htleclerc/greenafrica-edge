'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';
import { declarePaymentIntent } from '@/actions/declarePaymentIntent';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    transactionId: string;
    invoiceRef: string;
    amountUsd: number;
}

export function PayProformaDialog({
    open,
    onOpenChange,
    transactionId,
    invoiceRef,
    amountUsd,
}: Props) {
    const router = useRouter();
    const [reference, setReference] = React.useState('');
    const [notes, setNotes] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [isPending, startTransition] = React.useTransition();

    React.useEffect(() => {
        if (open) {
            setReference('');
            setNotes('');
            setError(null);
        }
    }, [open]);

    function submit() {
        setError(null);
        startTransition(async () => {
            const result = await declarePaymentIntent({
                transactionId,
                reference,
                amountUsd,
                notes,
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
                    className="fixed left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{
                        backgroundColor: 'var(--os-surface-2)',
                        border: '1px solid var(--os-border)',
                    }}
                >
                    <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                        Declare payment
                    </Dialog.Title>
                    <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                        Enter the bank-transfer reference for pro-forma{' '}
                        <span className="font-mono text-emerald-400">{invoiceRef}</span>{' '}
                        (${amountUsd.toLocaleString()} USD). Finance will reconcile it
                        against the bank statement and confirm.
                    </Dialog.Description>

                    <div className="flex flex-col gap-3">
                        <OsInput
                            label="Bank reference"
                            value={reference}
                            onChange={(e) => setReference(e.target.value)}
                            placeholder="WIRE-2026-00123"
                            autoFocus
                            error={error ?? undefined}
                        />
                        <OsInput
                            label="Notes (optional)"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Sender bank, payer name…"
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
                            disabled={isPending || reference.trim().length < 3}
                        >
                            {isPending ? 'Submitting…' : 'Submit declaration'}
                        </OsButton>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
