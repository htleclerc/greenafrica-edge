'use client';

import * as React from 'react';
import { ArrowLeft, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { useRecordPayment } from './useRecordPaymentContext';
import { ALLOWED_PROOF_MIME_TYPES, MAX_PROOF_SIZE_BYTES } from '@/services/paymentProofService';

export function StepRailParams() {
    const t = useTranslations('AdminPayments.recordDialog');
    const ctx = useRecordPayment();
    const [local, setLocal] = React.useState<Record<string, string>>({});
    const fileRef = React.useRef<HTMLInputElement>(null);

    function set(k: string, v: string) {
        setLocal((s) => ({ ...s, [k]: v }));
    }

    function handleFiles(list: FileList | null) {
        if (!list) return;
        const next: File[] = [...ctx.proofs];
        for (const f of Array.from(list)) {
            if (f.size > MAX_PROOF_SIZE_BYTES) { ctx.setError(t('errors.fileTooBig', { name: f.name })); continue; }
            if (!ALLOWED_PROOF_MIME_TYPES.has(f.type)) { ctx.setError(t('errors.fileMime', { name: f.name })); continue; }
            next.push(f);
        }
        ctx.setProofs(next);
    }

    function removeFile(i: number) {
        ctx.setProofs(ctx.proofs.filter((_, idx) => idx !== i));
    }

    function next() {
        if (!ctx.amount || !/^\d+(\.\d{1,2})?$/.test(ctx.amount)) {
            ctx.setError(t('errors.amountInvalid')); return;
        }
        // Rail-specific required fields
        const required = REQUIRED_FIELDS[ctx.rail!];
        for (const k of required) {
            if (!local[k]) {
                ctx.setError(t(`errors.required.${k}`));
                return;
            }
        }
        ctx.setRailDetails(buildRailDetails(ctx.rail!, local));
        ctx.setError(null);
        ctx.setStep('confirm');
    }

    function back() { ctx.setError(null); ctx.setStep('who'); }

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--os-text-muted)]">
                {t(`step2.hint.${ctx.rail!.toLowerCase()}`)}
            </p>

            {/* Amount + currency */}
            <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                    <Field label={t('step2.amount')} required>
                        <OsInput value={ctx.amount} onChange={(e) => ctx.setAmount(e.target.value)} placeholder="0.00" />
                    </Field>
                </div>
                <div>
                    <Field label={t('step2.currency')}>
                        <OsInput value={ctx.currency} onChange={(e) => ctx.setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="USD" />
                    </Field>
                </div>
            </div>

            {/* Rail-specific fields */}
            {ctx.rail === 'CASH' && (
                <>
                    <Field label={t('step2.field.receiptNumber')} required>
                        <OsInput value={local.receipt_number ?? ''} onChange={(e) => set('receipt_number', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.cashier')} required>
                        <OsInput value={local.cashier ?? ''} onChange={(e) => set('cashier', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'CHEQUE' && (
                <>
                    <Field label={t('step2.field.chequeNumber')} required>
                        <OsInput value={local.cheque_number ?? ''} onChange={(e) => set('cheque_number', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.bankName')} required>
                        <OsInput value={local.bank_name ?? ''} onChange={(e) => set('bank_name', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.chequeDate')}>
                        <OsInput type="date" value={local.cheque_date ?? ''} onChange={(e) => set('cheque_date', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'LETTER_OF_CREDIT' && (
                <>
                    <Field label={t('step2.field.lcNumber')} required>
                        <OsInput value={local.lc_number ?? ''} onChange={(e) => set('lc_number', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.issuingBank')} required>
                        <OsInput value={local.issuing_bank ?? ''} onChange={(e) => set('issuing_bank', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.expiryDate')}>
                        <OsInput type="date" value={local.expiry_date ?? ''} onChange={(e) => set('expiry_date', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'NETTING' && (
                <>
                    <Field label={t('step2.field.counterparty')} required>
                        <OsInput value={local.counterparty ?? ''} onChange={(e) => set('counterparty', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.netSettlementRef')} required>
                        <OsInput value={local.net_settlement_ref ?? ''} onChange={(e) => set('net_settlement_ref', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'THIRD_PARTY' && (
                <>
                    <Field label={t('step2.field.payerName')} required>
                        <OsInput value={local.payer_name ?? ''} onChange={(e) => set('payer_name', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.payerRelationship')}>
                        <OsInput value={local.payer_relationship ?? ''} onChange={(e) => set('payer_relationship', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.externalReference')}>
                        <OsInput value={local.external_reference ?? ''} onChange={(e) => set('external_reference', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'BANK_GUARANTEE' && (
                <>
                    <Field label={t('step2.field.guaranteeNumber')} required>
                        <OsInput value={local.guarantee_number ?? ''} onChange={(e) => set('guarantee_number', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.issuingBank')} required>
                        <OsInput value={local.issuing_bank ?? ''} onChange={(e) => set('issuing_bank', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.expiryDate')}>
                        <OsInput type="date" value={local.expiry_date ?? ''} onChange={(e) => set('expiry_date', e.target.value)} />
                    </Field>
                </>
            )}

            {/* Proofs */}
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                    {t('step2.proofs')}
                </p>
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[#38BDF8]"
                >
                    <Upload className="w-3.5 h-3.5" />
                    {t('step2.proofsCta')}
                </button>
                <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                />
                {ctx.proofs.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                        {ctx.proofs.map((f, i) => (
                            <li key={i} className="flex items-center gap-2 px-2 py-1 rounded-md bg-[var(--os-surface-2)] text-[11px]">
                                <span className="flex-1 truncate font-mono">{f.name}</span>
                                <span className="text-[var(--os-text-muted)]">{(f.size / 1024).toFixed(0)} KB</span>
                                <button onClick={() => removeFile(i)}><X className="w-3 h-3 text-[#EF4444]" /></button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {ctx.error && <p className="text-xs text-[#EF4444]">{ctx.error}</p>}

            <div className="flex items-center justify-between mt-2">
                <OsButton variant="secondary" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={back}>
                    {t('back')}
                </OsButton>
                <OsButton variant="primary" size="sm" onClick={next}>{t('next')}</OsButton>
            </div>
        </div>
    );
}

const REQUIRED_FIELDS: Record<string, string[]> = {
    CASH:             ['receipt_number', 'cashier'],
    CHEQUE:           ['cheque_number', 'bank_name'],
    LETTER_OF_CREDIT: ['lc_number', 'issuing_bank'],
    NETTING:          ['counterparty', 'net_settlement_ref'],
    THIRD_PARTY:      ['payer_name'],
    BANK_GUARANTEE:   ['guarantee_number', 'issuing_bank'],
};

function buildRailDetails(rail: string, local: Record<string, string>): Record<string, unknown> {
    // Strip empty strings, return clean snake_case object.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(local)) {
        if (v && v.trim() !== '') out[k] = v.trim();
    }
    return out;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-[var(--os-text-secondary)] uppercase tracking-wide">
                {label} {required && <span className="text-[#EF4444]">*</span>}
            </span>
            {children}
        </label>
    );
}
