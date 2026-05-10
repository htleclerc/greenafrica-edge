'use client';

import * as React from 'react';
import { ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { recordManualPayment } from '@/actions/recordManualPayment';
import { useRecordPayment } from './useRecordPaymentContext';

export function StepConfirm({ onClose }: { onClose: () => void }) {
    const t = useTranslations('AdminPayments.recordDialog');
    const ctx = useRecordPayment();

    const isCash = ctx.rail === 'CASH';

    function back() { ctx.setError(null); ctx.setStep('params'); }

    async function submit() {
        if (!ctx.rail || !ctx.shipowner) { ctx.setError(t('errors.invalidState')); return; }
        ctx.setSubmitting(true); ctx.setError(null);
        try {
            const created = await recordManualPayment({
                shipownerId: ctx.shipowner.id,
                transactionId: ctx.transaction?.id ?? null,
                rail: ctx.rail,
                amount: ctx.amount,
                currency: ctx.currency,
                railDetails: ctx.railDetails,
                confirmImmediately: ctx.confirmImmediately, // server will FORCE false for CASH
            });

            // Upload proofs after successful insert
            if (ctx.proofs.length > 0) {
                // Use a client-side Supabase fetch — proofs upload uses the service from inside the client.
                // The browser-safe pattern: POST to /api/admin/payments/[id]/proofs with form-data,
                // OR the server action returns the id and we issue uploads with the user's RLS scope.
                // Spec keeps this simple: a separate POST per file to a small route.
                for (const file of ctx.proofs) {
                    const fd = new FormData();
                    fd.append('file', file);
                    if (ctx.shipowner) fd.append('shipowner_id', ctx.shipowner.id);
                    const res = await fetch(`/api/admin/payments/${created.id}/proofs`, { method: 'POST', body: fd });
                    if (!res.ok) throw new Error(`proof upload failed: ${await res.text()}`);
                }
            }

            ctx.reset();
            onClose();
        } catch (e) {
            ctx.setError(e instanceof Error ? e.message : 'Submission failed');
        } finally {
            ctx.setSubmitting(false);
        }
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-[var(--os-border)] p-4 bg-[var(--os-surface-2)]">
                <SummaryRow label={t('summary.rail')}      value={ctx.rail ?? '—'} mono />
                <SummaryRow label={t('summary.shipowner')} value={ctx.shipowner?.name ?? '—'} />
                <SummaryRow label={t('summary.transaction')} value={ctx.transaction?.invoice_ref ?? ctx.transaction?.id.slice(0, 8) ?? t('summary.noTransaction')} mono />
                <SummaryRow label={t('summary.amount')}    value={`${ctx.amount} ${ctx.currency}`} mono />
                <SummaryRow label={t('summary.proofs')}    value={`${ctx.proofs.length}`} />
                {Object.keys(ctx.railDetails).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--os-border)]">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                            {t('summary.details')}
                        </p>
                        <pre className="text-[11px] text-[var(--os-text-secondary)] whitespace-pre-wrap font-mono">
                            {JSON.stringify(ctx.railDetails, null, 2)}
                        </pre>
                    </div>
                )}
            </div>

            {/* Confirm-immediately toggle */}
            <div
                className="flex items-center gap-3 p-3 rounded-xl border border-[var(--os-border)]"
                style={{ backgroundColor: isCash ? 'rgba(234,179,8,0.05)' : undefined }}
            >
                <input
                    id="confirm-immediately"
                    type="checkbox"
                    checked={ctx.confirmImmediately && !isCash}
                    onChange={(e) => ctx.setConfirmImmediately(e.target.checked)}
                    disabled={isCash}
                    className="w-4 h-4"
                />
                <label htmlFor="confirm-immediately" className="text-xs text-[var(--os-text-primary)] flex-1">
                    {t('summary.confirmImmediately')}
                </label>
                {isCash && (
                    <span className="flex items-center gap-1 text-[10px] text-[#EAB308]">
                        <AlertTriangle className="w-3 h-3" />
                        {t('summary.fourEyesRequired')}
                    </span>
                )}
            </div>

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

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between py-1 first:pt-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                {label}
            </span>
            <span className={`text-xs ${mono ? 'font-mono' : ''} text-[var(--os-text-primary)]`}>
                {value}
            </span>
        </div>
    );
}
