'use client';

import * as React from 'react';
import { ArrowLeft, Check, Copy, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { WIRE_BENEFICIARY } from '@/lib/payments/wireBeneficiary';
import { usePayDialog } from './usePayDialogContext';

export function StepRailParams() {
    const t = useTranslations('OwnerPortal.payDialog');
    const ctx = usePayDialog();
    const [local, setLocal] = React.useState<Record<string, string>>({});

    // Reference a porter sur le virement : la facture quand il y en a une,
    // sinon un marqueur de recharge — le service financier n'a que le libelle
    // du releve pour rapprocher les fonds.
    const wireReferenceLabel = ctx.invoiceRef ?? 'TOPUP';

    // Ordre de virement a remettre a sa banque. Une facture est identifiee par
    // son id : le montant est alors relu en base cote serveur. Une recharge n'a
    // pas de ligne en base, le montant saisi voyage donc en clair.
    const wireDownloadHref = ctx.transactionId
        ? `/api/owner/wire-instructions?transactionId=${encodeURIComponent(ctx.transactionId)}`
        : `/api/owner/wire-instructions?amountUsd=${encodeURIComponent(ctx.amountUsd.toFixed(2))}`;

    function set(k: string, v: string) {
        setLocal((s) => ({ ...s, [k]: v }));
    }

    function next() {
        // Topup mode: validate the owner-entered amount before per-rail checks
        if (ctx.mode === 'topup' && !(ctx.amountUsd > 0)) {
            ctx.setError(t('errors.amountRequired'));
            return;
        }
        // Validate per rail
        if (ctx.rail === 'WIRE_TRANSFER') {
            // La reference bancaire n'est plus exigee : au moment ou l'armateur
            // declare le virement, il ne l'a generalement pas encore. C'est la
            // preuve televersee a l'ecran suivant, puis la validation du service
            // financier, qui font foi — pas un numero saisi a la main.
            ctx.setRailDetails({
                bank_reference: local.bankReference || null,
                bank_name: local.bankName ?? null,
                notes: local.notes ?? null,
                wire_reference_quoted: wireReferenceLabel,
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

            {ctx.mode === 'topup' && (
                <Field label={t('field.topupAmount')} required>
                    <OsInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={ctx.amountUsd > 0 ? String(ctx.amountUsd) : ''}
                        onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            ctx.setAmountUsd(Number.isFinite(v) ? v : 0);
                        }}
                        placeholder="0.00"
                    />
                </Field>
            )}

            {ctx.rail === 'WIRE_TRANSFER' && (
                <>
                    <div className="rounded-xl border border-[var(--os-border)] bg-[var(--os-surface-2)] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">
                            {t('wire.accountTitle')}
                        </p>
                        <dl className="flex flex-col gap-1.5">
                            <WireLine label={t('wire.beneficiary')} value={WIRE_BENEFICIARY.beneficiary} />
                            <WireLine label={t('wire.bank')} value={WIRE_BENEFICIARY.bank} />
                            <WireLine label={t('wire.iban')} value={WIRE_BENEFICIARY.iban} mono copyable />
                            <WireLine label={t('wire.swift')} value={WIRE_BENEFICIARY.swiftCode} mono copyable />
                            <WireLine label={t('wire.reference')} value={wireReferenceLabel} mono copyable highlight />
                            <WireLine
                                label={t('wire.amount')}
                                value={ctx.amountUsd.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                            />
                        </dl>
                        <p className="text-[10px] text-[var(--os-text-muted)] mt-2 leading-relaxed">
                            {WIRE_BENEFICIARY.bankAddress}
                        </p>
                        <a
                            href={wireDownloadHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-3 text-xs text-emerald-400 hover:underline"
                        >
                            <Download className="w-3.5 h-3.5" />
                            {t('wire.download')}
                        </a>
                    </div>

                    <ol className="flex flex-col gap-1 text-[11px] text-[var(--os-text-secondary)] leading-relaxed list-decimal list-inside">
                        <li>{t('wire.step1')}</li>
                        <li>{t('wire.step2')}</li>
                        <li>{t('wire.step3')}</li>
                    </ol>

                    {ctx.mode === 'topup' && (
                        <p className="text-[11px] text-[#EAB308] leading-relaxed">{t('wire.topupHint')}</p>
                    )}

                    <Field label={t('field.bankReference')}>
                        <OsInput value={local.bankReference ?? ''} onChange={(e) => set('bankReference', e.target.value)} placeholder="SWIFT-MT103-…" />
                        <span className="text-[10px] text-[var(--os-text-muted)]">{t('wire.bankReferenceOptional')}</span>
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

/**
 * Une ligne des coordonnees bancaires. Les valeurs a recopier dans l'ordre de
 * virement (IBAN, BIC, reference) sont copiables : les retaper a la main est
 * la premiere source de virement non rapproche.
 */
function WireLine({
    label,
    value,
    mono,
    copyable,
    highlight,
}: {
    label: string;
    value: string;
    mono?: boolean;
    copyable?: boolean;
    highlight?: boolean;
}) {
    const [copied, setCopied] = React.useState(false);

    async function copy() {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Presse-papiers refuse (contexte non securise, permission) : la
            // valeur reste lisible et selectionnable a l'ecran.
        }
    }

    return (
        <div className="flex items-baseline gap-2">
            <dt className="text-[10px] uppercase tracking-wide text-[var(--os-text-muted)] w-24 flex-shrink-0">
                {label}
            </dt>
            <dd
                className={`flex-1 min-w-0 break-all text-xs ${mono ? 'font-mono' : ''} ${
                    highlight ? 'text-[#10B981] font-semibold' : 'text-[var(--os-text-primary)]'
                }`}
            >
                {value}
            </dd>
            {copyable && (
                <button
                    type="button"
                    onClick={copy}
                    className="flex-shrink-0 text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors"
                    aria-label={`Copy ${label}`}
                >
                    {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
            )}
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
