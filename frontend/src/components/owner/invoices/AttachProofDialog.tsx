// frontend/src/components/owner/invoices/AttachProofDialog.tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { ProofUploader } from '@/components/payments/ProofUploader';
import { ownerProofAdapter } from '@/components/owner/ownerProofAdapter';
import { OsButton } from '@/components/ui/OsButton';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    paymentId: string;
    invoiceRef: string;
    /** Le paiement porte-t-il deja une piece ? Change ce que la boite annonce. */
    hasProof?: boolean;
}

/**
 * Rattache une piece a un paiement DEJA DECLARE.
 *
 * Ce n'est pas un second chemin pour payer : depuis que le justificatif est
 * exige a la soumission, un paiement declare sans piece est une exception —
 * un envoi qui a echoue, ou une declaration anterieure a cette regle. La boite
 * dit donc explicitement quel paiement elle complete, au lieu de reclamer « un
 * justificatif » sans rien soumettre ni rien valider.
 *
 * Elle se ferme par un bouton de validation, pas seulement par la croix : sans
 * geste finalisant, l'armateur ne savait pas si son fichier etait pris en
 * compte. Le televersement est immediat, la fermeture rafraichit la page pour
 * que l'ecran cesse de reclamer ce qui vient d'etre fourni.
 */
export function AttachProofDialog({ open, onOpenChange, paymentId, invoiceRef, hasProof = false }: Props) {
    const t = useTranslations('OwnerPortal.proofUpload');
    const router = useRouter();
    const adapter = React.useMemo(() => ownerProofAdapter(paymentId), [paymentId]);

    function close() {
        onOpenChange(false);
        router.refresh();
    }

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
            <div className="relative w-full max-w-md mx-4 rounded-2xl border p-5" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}>
                <div className="flex items-start justify-between mb-3">
                    <h2 className="text-base font-semibold text-[var(--os-text-primary)]">{t('dialogTitle', { ref: invoiceRef })}</h2>
                    <button onClick={close} aria-label="Close"><X className="w-4 h-4 text-[var(--os-text-muted)]" /></button>
                </div>

                <div className={`rounded-xl border p-3 mb-3 text-[12px] ${
                    hasProof
                        ? 'border-[var(--os-border)] bg-[var(--os-surface-2)] text-[var(--os-text-secondary)]'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                }`}>
                    {hasProof ? t('contextProvided') : t('contextMissing')}
                </div>

                <p className="text-[11px] text-[var(--os-text-muted)] mb-3">{t('intro')}</p>
                <ProofUploader list={adapter.list} upload={adapter.upload} remove={adapter.remove} />

                <div className="flex justify-end mt-4">
                    <OsButton variant="primary" size="sm" onClick={close}>
                        {t('done')}
                    </OsButton>
                </div>
            </div>
        </div>
    );
}
