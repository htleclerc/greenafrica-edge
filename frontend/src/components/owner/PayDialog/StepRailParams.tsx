'use client';

import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { usePayDialog } from './usePayDialogContext';

export function StepRailParams() {
    const t = useTranslations('OwnerPortal.payDialog');
    const ctx = usePayDialog();
    const [local, setLocal] = React.useState<Record<string, string>>({});

    function set(k: string, v: string) {
        setLocal((s) => ({ ...s, [k]: v }));
    }

    function next() {
        // Validate per rail
        if (ctx.rail === 'WIRE_TRANSFER') {
            if (!local.bankReference) { ctx.setError(t('errors.bankReferenceRequired')); return; }
            ctx.setRailDetails({
                bank_reference: local.bankReference,
                bank_name: local.bankName ?? null,
                notes: local.notes ?? null,
            });
        } else if (ctx.rail === 'MOBILE_MONEY') {
            if (!local.phoneNumber) { ctx.setError(t('errors.phoneRequired')); return; }
            ctx.setRailDetails({
                phone_number: local.phoneNumber,
                provider_hint: ctx.chosenProvider,
                operator_reference: local.operatorReference ?? null,
            });
        } else if (ctx.rail === 'THIRD_PARTY') {
            if (!local.payerName) { ctx.setError(t('errors.payerNameRequired')); return; }
            ctx.setRailDetails({
                payer_name: local.payerName,
                payer_relationship: local.payerRelationship ?? null,
                external_reference: local.externalReference ?? null,
            });
        } else if (ctx.rail === 'WALLET') {
            ctx.setRailDetails({ source: 'owner_initiated' });
        }
        ctx.setError(null);
        ctx.setStep('confirm');
    }

    function back() {
        ctx.setError(null);
        ctx.setStep('rail');
    }

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--os-text-muted)]">
                {t(`paramsHint.${ctx.rail?.toLowerCase()}`, { provider: ctx.chosenProvider ?? '' })}
            </p>

            {ctx.rail === 'WIRE_TRANSFER' && (
                <>
                    <Field label={t('field.bankReference')} required>
                        <OsInput value={local.bankReference ?? ''} onChange={(e) => set('bankReference', e.target.value)} placeholder="SWIFT-MT103-…" />
                    </Field>
                    <Field label={t('field.bankName')}>
                        <OsInput value={local.bankName ?? ''} onChange={(e) => set('bankName', e.target.value)} />
                    </Field>
                    <Field label={t('field.notes')}>
                        <OsInput value={local.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
                    </Field>
                </>
            )}

            {ctx.rail === 'MOBILE_MONEY' && (
                <>
                    <Field label={t('field.phoneNumber')} required>
                        <OsInput value={local.phoneNumber ?? ''} onChange={(e) => set('phoneNumber', e.target.value)} placeholder="+221 …" />
                    </Field>
                    <Field label={t('field.operatorReference')}>
                        <OsInput value={local.operatorReference ?? ''} onChange={(e) => set('operatorReference', e.target.value)} />
                    </Field>
                    <p className="text-[11px] text-[var(--os-text-muted)]">
                        {t('field.viaProvider', { provider: ctx.chosenProvider ?? '' })}
                    </p>
                </>
            )}

            {ctx.rail === 'THIRD_PARTY' && (
                <>
                    <Field label={t('field.payerName')} required>
                        <OsInput value={local.payerName ?? ''} onChange={(e) => set('payerName', e.target.value)} />
                    </Field>
                    <Field label={t('field.payerRelationship')}>
                        <OsInput value={local.payerRelationship ?? ''} onChange={(e) => set('payerRelationship', e.target.value)} />
                    </Field>
                    <Field label={t('field.externalReference')}>
                        <OsInput value={local.externalReference ?? ''} onChange={(e) => set('externalReference', e.target.value)} />
                    </Field>
                </>
            )}

            {ctx.rail === 'WALLET' && (
                <p className="text-xs text-[var(--os-text-primary)] py-2">
                    {t('field.walletConfirm', { balance: (ctx.walletBalanceUsdMinor / 100).toFixed(2) })}
                </p>
            )}

            {ctx.error && <p className="text-xs text-[#EF4444]">{ctx.error}</p>}

            <div className="flex items-center justify-between mt-2">
                <OsButton variant="secondary" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={back}>
                    {t('back')}
                </OsButton>
                <OsButton variant="primary" size="sm" onClick={next}>
                    {t('next')}
                </OsButton>
            </div>
        </div>
    );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[var(--os-text-secondary)] uppercase tracking-wide">
                {label} {required && <span className="text-[#EF4444]">*</span>}
            </span>
            {children}
        </label>
    );
}
