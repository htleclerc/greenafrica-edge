'use client';

import * as React from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { initiatePayment } from '@/actions/initiatePayment';
import { applyWallet } from '@/actions/applyWallet';
import { usePayDialog } from './usePayDialogContext';

export function StepConfirm({ onClose }: { onClose: () => void }) {
    const t = useTranslations('OwnerPortal.payDialog');
    const ctx = usePayDialog();
    const router = useRouter();

    function back() {
        ctx.setError(null);
        ctx.setStep('params');
    }

    async function submit() {
        if (!ctx.rail) { ctx.setError(t('errors.noRail')); return; }
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
                const result = await initiatePayment({
                    transactionId: ctx.transactionId,
                    amount: ctx.amountUsd.toFixed(2),
                    currency: ctx.currency,
                    rail: ctx.rail,
                    railDetails: ctx.railDetails,
                });

                // Plan 7D: STRIPE flow returns checkoutUrl — redirect the browser there.
                // The webhook will flip the payment to CONFIRMED + generate receipt + email
                // when the owner completes Checkout (or CANCELLED via cron reconcile if abandoned).
                if (ctx.rail === 'STRIPE' && 'checkoutUrl' in result && result.checkoutUrl) {
                    window.location.href = result.checkoutUrl as string;
                    return; // do NOT call onClose / router.refresh — page is about to unload
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

            <p className="text-[11px] text-[var(--os-text-muted)] leading-relaxed">
                {t('summary.disclaimer')}
            </p>

            {ctx.error && <p className="text-xs text-[#EF4444]">{ctx.error}</p>}

            <div className="flex items-center justify-between mt-2">
                <OsButton variant="secondary" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={back} disabled={ctx.submitting}>
                    {t('back')}
                </OsButton>
                <OsButton variant="primary" size="sm" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={submit} disabled={ctx.submitting}>
                    {ctx.submitting ? t('submitting') : t('submit')}
                </OsButton>
            </div>
        </div>
    );
}
