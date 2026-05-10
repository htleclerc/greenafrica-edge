'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { RecordPaymentProvider, useRecordPayment } from './useRecordPaymentContext';
import { StepRailAndShipowner } from './StepRailAndShipowner';
import { StepRailParams } from './StepRailParams';
import { StepConfirm } from './StepConfirm';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function StepIndicator() {
    const { step } = useRecordPayment();
    const idx = ['who', 'params', 'confirm'].indexOf(step);
    return (
        <div className="flex items-center gap-1.5 mb-3">
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    className="flex-1 h-1 rounded-full"
                    style={{ backgroundColor: i <= idx ? '#10B981' : 'var(--os-surface-2)' }}
                />
            ))}
        </div>
    );
}

function Body({ onClose }: { onClose: () => void }) {
    const { step } = useRecordPayment();
    const t = useTranslations('AdminPayments.recordDialog');
    return (
        <>
            <Dialog.Title className="text-base font-semibold mb-1">{t('title')}</Dialog.Title>
            <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-4">
                {t('subtitle')}
            </Dialog.Description>
            <StepIndicator />
            {step === 'who'     && <StepRailAndShipowner />}
            {step === 'params'  && <StepRailParams />}
            {step === 'confirm' && <StepConfirm onClose={onClose} />}
        </>
    );
}

export function RecordManualPaymentDialog(props: Props) {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-[600px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{
                        backgroundColor: 'var(--os-surface-2)',
                        border: '1px solid var(--os-border)',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                    }}
                >
                    <RecordPaymentProvider>
                        <Body onClose={() => props.onOpenChange(false)} />
                    </RecordPaymentProvider>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
