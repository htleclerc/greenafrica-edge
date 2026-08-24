'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, RefreshCw, Upload, WifiOff, X } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usdGrouped } from '@/lib/osMoney';
import { recordManualPayment } from '@/actions/recordManualPayment';
import { ALLOWED_PROOF_MIME_TYPES, MAX_PROOF_SIZE_BYTES } from '@/services/paymentProofService';

interface ShipownerOption { id: string; name: string }
interface TransactionOption { id: string; invoice_ref: string | null; tax_amount_usd: number }

/**
 * Moyens acceptés au guichet. Des tuiles de 56 px en grille 1fr 1fr, pas une
 * liste déroulante : au guichet on tape vite et large, et le moyen reçu est la
 * seule chose que le caissier connaît avant même d'ouvrir l'écran.
 */
const METHODS = ['cash', 'mobileMoney', 'cheque', 'transfer'] as const;
type Method = (typeof METHODS)[number];

/**
 * Encaissement au guichet — conçu pour une main, debout, réseau intermittent.
 *
 * L'écran suit l'ordre du geste réel : on identifie le navire ou l'armateur, on
 * lit ce qu'il doit, on encaisse, on vérifie le reliquat, on imprime. Aucune
 * cible tactile ne descend sous 44 px.
 */
export function CashDeskForm() {
    const t = useTranslations('AdminCashDesk');
    const { isOnline } = useOnlineStatus();

    const [shipownerQuery, setShipownerQuery] = React.useState('');
    const [shipownerResults, setShipownerResults] = React.useState<ShipownerOption[]>([]);
    const [shipowner, setShipowner] = React.useState<ShipownerOption | null>(null);
    const [txnResults, setTxnResults] = React.useState<TransactionOption[]>([]);
    const [transaction, setTransaction] = React.useState<TransactionOption | null>(null);
    const [method, setMethod] = React.useState<Method>('cash');
    const [amount, setAmount] = React.useState('');
    const [currency, setCurrency] = React.useState('USD');
    const [receiptNumber, setReceiptNumber] = React.useState(buildAutoReceiptNumber());
    const [proof, setProof] = React.useState<File | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [success, setSuccess] = React.useState<{ paymentId: string; receiptNumber: string } | null>(null);
    const fileRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (shipownerQuery.length < 2 || shipowner) { setShipownerResults([]); return; }
        const timer = setTimeout(async () => {
            const url = new URL('/api/admin/shipowners/search', window.location.origin);
            url.searchParams.set('q', shipownerQuery);
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                setShipownerResults(data.shipowners ?? []);
            }
        }, 250);
        return () => clearTimeout(timer);
    }, [shipownerQuery, shipowner]);

    React.useEffect(() => {
        if (!shipowner) { setTxnResults([]); return; }
        (async () => {
            const res = await fetch(`/api/admin/shipowners/${shipowner.id}/open-transactions`);
            if (res.ok) {
                const data = await res.json();
                setTxnResults(data.transactions ?? []);
            }
        })();
    }, [shipowner]);

    // Le dû : la facture retenue si le caissier en a choisi une, sinon tout ce que
    // l'armateur a d'ouvert. C'est le total que le reliquat compare au reçu.
    const dueUsd = transaction
        ? transaction.tax_amount_usd
        : txnResults.reduce((sum, tx) => sum + tx.tax_amount_usd, 0);

    const receivedUsd = Number.parseFloat(amount);
    const remainder = Number.isFinite(receivedUsd) ? receivedUsd - dueUsd : null;

    function reset(keepShipowner = true) {
        if (!keepShipowner) {
            setShipowner(null);
            setShipownerQuery('');
        }
        setTransaction(null);
        setAmount('');
        setCurrency('USD');
        setMethod('cash');
        setProof(null);
        setReceiptNumber(buildAutoReceiptNumber());
        setError(null);
    }

    function pickFile(list: FileList | null) {
        if (!list || list.length === 0) return;
        const f = list[0];
        if (f.size > MAX_PROOF_SIZE_BYTES) { setError(t('errors.fileTooBig')); return; }
        if (!ALLOWED_PROOF_MIME_TYPES.has(f.type)) { setError(t('errors.fileMime')); return; }
        setProof(f);
        setError(null);
    }

    async function submit() {
        setError(null);
        if (!shipowner) { setError(t('errors.shipownerRequired')); return; }
        if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount)) { setError(t('errors.amountInvalid')); return; }
        if (!receiptNumber.trim()) { setError(t('errors.receiptRequired')); return; }

        setSubmitting(true);
        try {
            const created = await recordManualPayment({
                shipownerId: shipowner.id,
                transactionId: transaction?.id ?? null,
                // Le rail reste CASH : c'est le rail d'encaissement au guichet, quel
                // que soit l'instrument reçu. L'instrument est tracé dans railDetails
                // — un chèque encaissé au guichet n'est pas un virement bancaire.
                rail: 'CASH',
                amount,
                currency,
                railDetails: {
                    receipt_number: receiptNumber,
                    tender_method: method,
                    cashier: 'self', // server stamps declared_by from auth session
                },
                confirmImmediately: false, // forced false for CASH anyway (mig 057 rule)
            });

            if (proof) {
                const fd = new FormData();
                fd.append('file', proof);
                fd.append('shipowner_id', shipowner.id);
                await fetch(`/api/admin/payments/${created.id}/proofs`, { method: 'POST', body: fd });
            }

            setSuccess({ paymentId: created.id, receiptNumber });
            reset(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('errors.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-3.5 p-4 sm:p-6">
            <header className="flex items-center justify-between gap-3">
                <h1 className="text-lg font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
                {!isOnline && (
                    <span className="flex items-center gap-1.5 rounded-full bg-[var(--os-yellow)]/12 px-2.5 py-1 text-[11.5px] text-[var(--os-yellow)]">
                        <WifiOff className="size-3.5" aria-hidden />
                        {t('offlineBadge')}
                    </span>
                )}
            </header>
            <p className="text-xs text-[var(--os-text-muted)]">{t('subtitle')}</p>

            {success && (
                <div className="flex items-start gap-3 rounded-xl border border-[var(--os-green)]/20 bg-[var(--os-green)]/10 p-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--os-green)]" aria-hidden />
                    <div>
                        <p className="text-sm font-semibold text-[var(--os-green)]">{t('success.title')}</p>
                        <p className="text-xs text-[var(--os-text-muted)]">{t('success.body', { ref: success.receiptNumber })}</p>
                        <button onClick={() => setSuccess(null)} className="mt-1 text-[10px] text-[var(--os-green)] underline">
                            {t('success.dismiss')}
                        </button>
                    </div>
                </div>
            )}

            {/* ── 1. Identification ────────────────────────────────────────── */}
            <section className="os-card flex flex-col gap-2 p-4">
                <SectionLabel>{t('field.shipowner')}</SectionLabel>
                <OsInput
                    value={shipowner ? shipowner.name : shipownerQuery}
                    onChange={(e) => {
                        if (shipowner) setShipowner(null);
                        setShipownerQuery(e.target.value);
                    }}
                    placeholder={t('field.shipownerPlaceholder')}
                />
                {!shipowner && shipownerResults.length > 0 && (
                    <ul className="max-h-52 overflow-y-auto rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)]">
                        {shipownerResults.map((s) => (
                            <li key={s.id}>
                                <button
                                    type="button"
                                    onClick={() => { setShipowner(s); setShipownerQuery(''); setShipownerResults([]); }}
                                    className="flex h-11 w-full items-center px-3 text-left text-[13px] text-[var(--os-text-primary)] transition-colors duration-150 hover:bg-[var(--os-surface-3)]"
                                >
                                    {s.name}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {shipowner && txnResults.length > 0 && (
                    <label className="mt-1 flex flex-col gap-1">
                        <SectionLabel>{t('field.transaction')}</SectionLabel>
                        <select
                            value={transaction?.id ?? ''}
                            onChange={(e) => {
                                const tx = txnResults.find((x) => x.id === e.target.value) ?? null;
                                setTransaction(tx);
                                if (tx) setAmount(tx.tax_amount_usd.toFixed(2));
                            }}
                            className="h-11 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 text-[13px] text-[var(--os-text-primary)]"
                        >
                            <option value="">{t('field.transactionNone')}</option>
                            {txnResults.map((tx) => (
                                <option key={tx.id} value={tx.id}>
                                    {tx.invoice_ref ?? tx.id.slice(0, 8)} — {usdGrouped(tx.tax_amount_usd)}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </section>

            {/* ── 2. Ce qu'il doit ─────────────────────────────────────────── */}
            {shipowner && dueUsd > 0 && (
                <section className="os-card flex flex-col gap-2.5 p-4">
                    <div className="flex items-baseline justify-between text-[13px] text-[var(--os-text-muted)]">
                        <span>{transaction ? t('due.invoice') : t('due.allOpen', { count: txnResults.length })}</span>
                        <span className="font-mono text-[var(--os-text-secondary)]">{usdGrouped(dueUsd)}</span>
                    </div>
                    <div className="flex items-baseline justify-between border-t border-[var(--os-border)] pt-2.5 text-[13px] text-[var(--os-text-secondary)]">
                        <span>{t('due.toCollect')}</span>
                        <span className="font-mono text-[28px] font-semibold tabular-nums text-[var(--os-text-primary)]">
                            {usdGrouped(dueUsd)}
                        </span>
                    </div>
                </section>
            )}

            {/* ── 3. Moyen reçu ────────────────────────────────────────────── */}
            <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-[13px] font-semibold text-[var(--os-text-primary)]">
                    {t('methodLegend')}
                </legend>
                <div className="grid grid-cols-2 gap-2.5">
                    {METHODS.map((m) => {
                        const active = m === method;
                        return (
                            <button
                                key={m}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setMethod(m)}
                                className={`
                                    flex h-14 items-center justify-center rounded-xl border px-3 text-[14.5px]
                                    transition-colors duration-150
                                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]
                                    ${active
                                        ? 'border-[var(--os-brand-green)]/45 bg-[var(--os-brand-green)]/8 font-semibold text-[var(--os-brand-cyan)]'
                                        : 'border-[var(--os-border-strong)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-2)]'}
                                `}
                            >
                                {t(`method.${m}`)}
                            </button>
                        );
                    })}
                </div>
            </fieldset>

            {/* ── 4. Montant reçu et reliquat ──────────────────────────────── */}
            <section className="os-card flex flex-col gap-2.5 p-4">
                <SectionLabel>{t('field.amount')}</SectionLabel>
                <div className="flex items-center gap-2">
                    <input
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        aria-label={t('field.amount')}
                        className="h-14 w-full min-w-0 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 font-mono text-[30px] font-semibold tabular-nums text-[var(--os-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--os-brand-green)]"
                    />
                    <input
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                        aria-label={t('field.currency')}
                        className="h-14 w-20 shrink-0 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 text-center font-mono text-sm text-[var(--os-text-primary)]"
                    />
                </div>
                {/* Le reliquat se vérifie à l'écran, pas de tête : c'est l'erreur la
                    plus coûteuse du guichet, et la seule que l'écran peut éviter. */}
                {remainder !== null && dueUsd > 0 && (
                    <p
                        className={`text-[12.5px] ${
                            remainder === 0 ? 'text-[var(--os-green)]'
                            : remainder > 0 ? 'text-[var(--os-yellow)]'
                            : 'text-[var(--os-red)]'
                        }`}
                    >
                        {remainder === 0
                            ? t('remainder.exact')
                            : remainder > 0
                                ? t('remainder.change', { amount: usdGrouped(remainder) })
                                : t('remainder.short', { amount: usdGrouped(-remainder) })}
                    </p>
                )}
            </section>

            {/* ── 5. Reçu et pièce ─────────────────────────────────────────── */}
            <section className="os-card flex flex-col gap-2.5 p-4">
                <SectionLabel>{t('field.receiptNumber')}</SectionLabel>
                <div className="flex items-center gap-2">
                    <OsInput value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} />
                    <button
                        type="button"
                        onClick={() => setReceiptNumber(buildAutoReceiptNumber())}
                        title={t('field.regen')}
                        aria-label={t('field.regen')}
                        className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[var(--os-border-strong)] text-[var(--os-text-muted)] transition-colors duration-150 hover:text-[var(--os-text-primary)]"
                    >
                        <RefreshCw className="size-4" aria-hidden />
                    </button>
                </div>

                <SectionLabel>{t('field.proof')}</SectionLabel>
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--os-border-strong)] px-3 text-xs text-[var(--os-text-muted)] transition-colors duration-150 hover:border-[var(--os-brand-green)] hover:text-[var(--os-text-primary)]"
                >
                    <Upload className="size-3.5" aria-hidden />
                    {proof ? proof.name : t('field.proofCta')}
                </button>
                <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                    className="hidden"
                    onChange={(e) => pickFile(e.target.files)}
                />
                {proof && (
                    <button onClick={() => setProof(null)} className="self-start text-[10px] text-[var(--os-red)]">
                        <X className="inline size-3" aria-hidden /> {t('field.proofRemove')}
                    </button>
                )}
            </section>

            {error && <p role="alert" className="text-xs text-[var(--os-red)]">{error}</p>}

            {/* ── 6. Valider ───────────────────────────────────────────────── */}
            <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="flex h-[54px] items-center justify-center rounded-xl bg-[var(--os-brand-green)] px-4 text-[15.5px] font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
            >
                {submitting ? t('submitting') : t('submit')}
            </button>

            <p className="text-center text-[11.5px] leading-relaxed text-[var(--os-text-muted)]">
                {isOnline ? t('fourEyesNote') : t('offlineNote')}
            </p>

            <OsButton variant="ghost" size="sm" onClick={() => reset(false)} disabled={submitting} className="!h-11">
                {t('reset')}
            </OsButton>
        </div>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
            {children}
        </span>
    );
}

function buildAutoReceiptNumber(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    // NNN counter is best-effort: use minutes-of-day mod 1000 for uniqueness within a busy day.
    // Cashier can edit if a duplicate is suggested.
    const counter = String(now.getHours() * 60 + now.getMinutes()).padStart(3, '0');
    return `CASH-${y}-${m}-${d}-${counter}`;
}
