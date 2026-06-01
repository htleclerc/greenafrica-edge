// frontend/src/app/owner/(portal)/invoices/AttachProofDialog.tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { ProofUploader } from '@/components/payments/ProofUploader';
import { ownerProofAdapter } from '@/components/owner/ownerProofAdapter';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    paymentId: string;
    invoiceRef: string;
}

export function AttachProofDialog({ open, onOpenChange, paymentId, invoiceRef }: Props) {
    const t = useTranslations('OwnerPortal.proofUpload');
    const adapter = React.useMemo(() => ownerProofAdapter(paymentId), [paymentId]);
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
            <div className="relative w-full max-w-md mx-4 rounded-2xl border p-5" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}>
                <div className="flex items-start justify-between mb-3">
                    <h2 className="text-base font-semibold text-[var(--os-text-primary)]">{t('dialogTitle', { ref: invoiceRef })}</h2>
                    <button onClick={() => onOpenChange(false)} aria-label="Close"><X className="w-4 h-4 text-[var(--os-text-muted)]" /></button>
                </div>
                <p className="text-[11px] text-[var(--os-text-muted)] mb-3">{t('intro')}</p>
                <ProofUploader list={adapter.list} upload={adapter.upload} remove={adapter.remove} />
            </div>
        </div>
    );
}
