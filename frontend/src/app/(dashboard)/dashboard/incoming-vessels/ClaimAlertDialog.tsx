'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Ship } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { claimArrivalAlert } from '@/actions/claimArrivalAlert'; // Task 7 dependency
import type { ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';

interface Props {
    alert: ArrivalAlertWithVessel;
    open: boolean;
    onClose: () => void;
}

export function ClaimAlertDialog({ alert, open, onClose }: Props) {
    const t = useTranslations('IncomingVessels.claimDialog');
    const [email, setEmail]     = React.useState('');
    const [error, setError]     = React.useState<string | null>(null);
    const [pending, startTransition] = React.useTransition();

    function submit() {
        const trimmed = email.trim();
        if (!trimmed.includes('@') || trimmed.length < 5) {
            setError(t('invalidEmail'));
            return;
        }
        setError(null);
        startTransition(async () => {
            const result = await claimArrivalAlert({ alertId: alert.id, ownerEmail: trimmed });
            if (!result.ok) {
                setError(result.reason);
                return;
            }
            onClose();
        });
    }

    return (
        <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className="fixed inset-0 z-50"
                    style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
                />
                <Dialog.Content
                    className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg mx-4 rounded-2xl border overflow-hidden flex flex-col"
                    style={{
                        backgroundColor: 'var(--os-surface)',
                        borderColor: 'var(--os-border-strong)',
                        maxHeight: '85vh',
                    }}
                >
                    {/* Header */}
                    <div
                        className="flex items-center justify-between px-5 py-3 border-b"
                        style={{ borderColor: 'var(--os-border)' }}
                    >
                        <div className="min-w-0">
                            <Dialog.Title className="text-sm font-bold text-[var(--os-text-primary)]">
                                {t('title')}
                            </Dialog.Title>
                            <Dialog.Description className="text-[10px] text-[var(--os-text-muted)] truncate">
                                {t('description', { vessel: alert.vessel?.name ?? alert.imo_number })}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button
                                disabled={pending}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors disabled:opacity-50"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </Dialog.Close>
                    </div>

                    {/* Body */}
                    <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
                        <div className="flex items-center gap-2 text-xs text-[var(--os-text-secondary)]">
                            <Ship className="w-3.5 h-3.5 text-[#00D97E]" />
                            <span className="font-mono">{alert.imo_number}</span>
                            <span className="opacity-40">·</span>
                            <span>{alert.distance_to_port_nm.toFixed(0)} NM</span>
                        </div>

                        <OsInput
                            type="email"
                            label={t('ownerEmailLabel')}
                            placeholder="ops@owner-company.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={pending}
                            error={error ?? undefined}
                        />
                    </div>

                    {/* Footer */}
                    <div
                        className="px-5 py-3 border-t flex items-center justify-end gap-2"
                        style={{ borderColor: 'var(--os-border)' }}
                    >
                        <OsButton variant="ghost" size="sm" onClick={onClose} disabled={pending}>
                            {t('cancel')}
                        </OsButton>
                        <OsButton
                            variant="primary"
                            size="sm"
                            onClick={submit}
                            loading={pending}
                            disabled={pending}
                        >
                            {pending ? t('claiming') : t('confirm')}
                        </OsButton>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
