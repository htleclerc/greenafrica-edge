'use client';

import * as React from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { initiatePayment } from '@/actions/initiatePayment';
import { applyWallet } from '@/actions/applyWallet';
import { ProofUploader } from '@/components/payments/ProofUploader';
import { ownerProofAdapter } from '@/components/owner/ownerProofAdapter';
import { railRequiresProof } from '@/lib/payments/proofRequirement';
import { useStagedProofs } from './useStagedProofs';
import { usePayDialog } from './usePayDialogContext';

export function StepConfirm({ onClose }: { onClose: () => void }) {
    const t = useTranslations('OwnerPortal.payDialog');
    const ctx = usePayDialog();
    const router = useRouter();
    // Renseigne UNIQUEMENT quand le paiement a ete cree mais que l'envoi des
    // pieces a echoue : le paiement existe deja, on ne peut plus le reprendre,
    // il faut donc laisser l'armateur reessayer contre son identifiant reel.
    const [orphanPaymentId, setOrphanPaymentId] = React.useState<string | null>(null);
    const staged = useStagedProofs();
    const needsProof = railRequiresProof(ctx.rail);

    function back() {
        ctx.setError(null);
        ctx.setStep('params');
    }

    async function submit() {
        if (!ctx.rail) { ctx.setError(t('errors.noRail')); return; }
        // Un versement declare sans piece n'est pas rapprochable : le service
        // financier ne peut ni le confirmer ni le refuser, et la facture reste
        // ouverte alors que l'armateur la croit reglee.
        if (needsProof && staged.files.length === 0) {
            ctx.setError(t('errors.proofRequired'));
            return;
        }
        ctx.setSubmitting(true);
        ctx.setError(null);
        try {
            if (ctx.rail === 'WALLET') {
                // WALLET rail is hidden in topup mode (filtered in StepRailPicker), so
                // transactionId is guaranteed non-null here. Guard anyway for type safety.
                if (!ctx.transactionId) {
                    throw new Error(t('errors.noTransactionForWallet'));
                }
                await applyWallet({
                    transactionId: ctx.transactionId,
                    amountMinor: Math.round(ctx.amountUsd * 100),
                });
            } else {
                // Paiement mixte : `amount` ne porte QUE le reste a payer sur
                // le rail, la part portefeuille voyage a part.
                const remainderUsd = ctx.amountUsd - ctx.walletApplyUsdMinor / 100;
                const result = await initiatePayment({
                    transactionId: ctx.transactionId,
                    amount: remainderUsd.toFixed(2),
                    currency: ctx.currency,
                    rail: ctx.rail,
                    railDetails: ctx.railDetails,
                    walletApplyUsdMinor: ctx.walletApplyUsdMinor || undefined,
                });

                // Rails à checkout externe (STRIPE, PAYPAL) : l'action renvoie une
                // checkoutUrl, on y envoie le navigateur.
                //
                // STRIPE : le webhook passe le paiement à CONFIRMED et génère reçu +
                // e-mail (ou CANCELLED via le cron si abandonné).
                // PAYPAL : la route de retour /api/payments/paypal/return capture et
                // confirme, avec le webhook et le cron en filet.
                const isCheckoutRail = ctx.rail === 'STRIPE' || ctx.rail === 'PAYPAL';
                if (isCheckoutRail && result.checkoutUrl) {
                    window.location.href = result.checkoutUrl;
                    return; // ne pas appeler onClose / router.refresh — la page va se décharger
                }

                // Rails declaratifs : le paiement vient d'etre cree, on envoie
                // les pieces retenues dans la foulee. L'ordre est impose par
                // l'API — le televersement vise un paiement existant.
                if (needsProof && 'id' in result && typeof result.id === 'string') {
                    const paymentId = result.id;
                    const adapter = ownerProofAdapter(paymentId);
                    try {
                        for (const file of staged.files) await adapter.upload(file);
                    } catch (e) {
                        // Le paiement EXISTE deja : l'annuler serait pire que de
                        // le laisser sans piece. On bascule sur l'envoi contre
                        // son identifiant reel plutot que de fermer en silence.
                        setOrphanPaymentId(paymentId);
                        ctx.setError(e instanceof Error ? e.message : t('errors.proofUploadFailed'));
                        ctx.setSubmitting(false);
                        return;
                    }
                }
            }
            ctx.reset();
            onClose();
            router.refresh();
        } catch (e) {
            ctx.setError(e instanceof Error ? e.message : 'Submission failed');
        } finally {
            ctx.setSubmitting(false);
        }
    }

    // Rattrapage : le paiement est enregistre, ses pieces ne sont pas montees.
    if (orphanPaymentId) {
        const adapter = ownerProofAdapter(orphanPaymentId);
        return (
            <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                    {t('proofStep.uploadFailed')}
                </div>
                <p className="text-[11px] text-[var(--os-text-muted)] leading-relaxed">{t('proofStep.intro')}</p>
                <ProofUploader list={adapter.list} upload={adapter.upload} remove={adapter.remove} />
                <div className="flex justify-end mt-2">
                    <OsButton variant="primary" size="sm" onClick={() => { ctx.reset(); onClose(); router.refresh(); }}>
                        {t('proofStep.done')}
                    </OsButton>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-[var(--os-border)] p-4 bg-[var(--os-surface-2)]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                    {ctx.mode === 'topup' ? t('mode.topup.summaryLabel') : t('summary.invoice')}
                </p>
                <p className="text-sm font-mono text-[var(--os-text-primary)]">
                    {ctx.invoiceRef ?? (ctx.mode === 'topup' ? t('mode.topup.summaryValue') : '—')}
                </p>

                <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">{t('summary.amount')}</p>
                        <p className="text-sm font-bold text-[var(--os-text-primary)]">
                            {ctx.amountUsd.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                        </p>
                    </div>
                    {ctx.walletApplyUsdMinor > 0 && (
                        <div className="col-span-2">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                                {t('summary.split')}
                            </p>
                            <p className="text-sm text-[var(--os-text-primary)]">
                                {t('summary.splitValue', {
                                    wallet: (ctx.walletApplyUsdMinor / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' }),
                                    remainder: (ctx.amountUsd - ctx.walletApplyUsdMinor / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' }),
                                    rail: ctx.rail ?? '',
                                })}
                            </p>
                        </div>
                    )}
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">{t('summary.rail')}</p>
                        <p className="text-sm font-bold text-[var(--os-text-primary)]">{ctx.rail}</p>
                    </div>
                </div>

                {ctx.chosenProvider && ctx.rail !== 'WALLET' && ctx.rail !== 'WIRE_TRANSFER' && (
                    <div className="mt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">{t('summary.provider')}</p>
                        <p className="text-sm text-[var(--os-text-primary)]">{ctx.chosenProvider}</p>
                    </div>
                )}

                {Object.keys(ctx.railDetails).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--os-border)]">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{t('summary.details')}</p>
                        <pre className="text-[11px] text-[var(--os-text-secondary)] whitespace-pre-wrap font-mono">
                            {JSON.stringify(ctx.railDetails, null, 2)}
                        </pre>
                    </div>
                )}
            </div>

            {needsProof && (
                <div className="rounded-xl border border-[var(--os-border)] p-4 bg-[var(--os-surface-2)]">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                        {t('proofStep.required')}
                    </p>
                    <p className="text-[11px] text-[var(--os-text-muted)] leading-relaxed mb-2">
                        {t('proofStep.requiredHint')}
                    </p>
                    <ProofUploader
                        list={staged.adapter.list}
                        upload={staged.adapter.upload}
                        remove={staged.adapter.remove}
                        disabled={ctx.submitting}
                    />
                </div>
            )}

            <p className="text-[11px] text-[var(--os-text-muted)] leading-relaxed">
                {t('summary.disclaimer')}
            </p>

            {ctx.error && <p className="text-xs text-[#EF4444]">{ctx.error}</p>}

            <div className="flex items-center justify-between mt-2">
                <OsButton variant="secondary" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={back} disabled={ctx.submitting}>
                    {t('back')}
                </OsButton>
                <OsButton
                    variant="primary" size="sm" icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                    onClick={submit}
                    disabled={ctx.submitting || (needsProof && staged.files.length === 0)}
                >
                    {ctx.submitting ? t('submitting') : t('submit')}
                </OsButton>
            </div>
        </div>
    );
}
