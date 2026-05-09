'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { PayDialogProvider, usePayDialog } from './usePayDialogContext';
import { StepRailPicker } from './StepRailPicker';
import { StepRailParams } from './StepRailParams';
import { StepConfirm } from './StepConfirm';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    transactionId: string;
    invoiceRef: string;
    amountUsd: number;
    currency: string;
    walletBalanceUsdMinor: number;
}

function StepIndicator() {
    const { step } = usePayDialog();
    const steps: Array<{ key: typeof step; label: string }> = [
        { key: 'rail', label: '1' },
        { key: 'params', label: '2' },
        { key: 'confirm', label: '3' },
    ];
    return (
        <div className="flex items-center gap-1.5 mb-3">
            {steps.map((s, i) => {
                const active = s.key === step;
                const done = steps.findIndex((x) => x.key === step) > i;
                return (
                    <React.Fragment key={s.key}>
                        <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{
                                backgroundColor: active ? '#10B981' : done ? '#10B98155' : 'var(--os-surface-2)',
                                color: active || done ? 'white' : 'var(--os-text-muted)',
                                border: '1px solid var(--os-border)',
                            }}
                        >
                            {s.label}
                        </div>
                        {i < steps.length - 1 && <div className="flex-1 h-px bg-[var(--os-border)]" />}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function PayDialogBody({ onClose }: { onClose: () => void }) {
    const { step } = usePayDialog();
    const t = useTranslations('OwnerPortal.payDialog');
    return (
        <>
            <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                {t('title')}
            </Dialog.Title>
            <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-4">
                {t('subtitle')}
            </Dialog.Description>
            <StepIndicator />
            {step === 'rail'    && <StepRailPicker />}
            {step === 'params'  && <StepRailParams />}
            {step === 'confirm' && <StepConfirm onClose={onClose} />}
        </>
    );
}

export function PayDialog(props: Props) {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className="fixed inset-0 z-50"
                    style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{
                        backgroundColor: 'var(--os-surface-2)',
                        border: '1px solid var(--os-border)',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                    }}
                >
                    <PayDialogProvider
                        transactionId={props.transactionId}
                        invoiceRef={props.invoiceRef}
                        amountUsd={props.amountUsd}
                        currency={props.currency}
                        walletBalanceUsdMinor={props.walletBalanceUsdMinor}
                    >
                        <PayDialogBody onClose={() => props.onOpenChange(false)} />
                    </PayDialogProvider>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
