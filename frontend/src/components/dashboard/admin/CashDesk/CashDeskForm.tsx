'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, CheckCircle2, RefreshCw, Upload, X } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { recordManualPayment } from '@/actions/recordManualPayment';
import { ALLOWED_PROOF_MIME_TYPES, MAX_PROOF_SIZE_BYTES } from '@/services/paymentProofService';

interface ShipownerOption { id: string; name: string }
interface TransactionOption { id: string; invoice_ref: string | null; tax_amount_usd: number }

export function CashDeskForm() {
    const t = useTranslations('AdminCashDesk');
    const [shipownerQuery, setShipownerQuery] = React.useState('');
    const [shipownerResults, setShipownerResults] = React.useState<ShipownerOption[]>([]);
    const [shipowner, setShipowner] = React.useState<ShipownerOption | null>(null);
    const [txnResults, setTxnResults] = React.useState<TransactionOption[]>([]);
    const [transaction, setTransaction] = React.useState<TransactionOption | null>(null);
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

    function reset(keepShipowner = true) {
        if (!keepShipowner) {
            setShipowner(null);
            setShipownerQuery('');
        }
        setTransaction(null);
        setAmount('');
        setCurrency('USD');
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
                rail: 'CASH',
                amount,
                currency,
                railDetails: {
                    receipt_number: receiptNumber,
                    cashier: 'self', // server stamps declared_by from auth session
                },
                confirmImmediately: false, // forced false for CASH anyway (mig 057 rule)
            });

            // Upload proof if present (uses Plan 7C-3 admin proof endpoint)
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
        <div className="os-card p-5 max-w-xl mx-auto">
            <header className="flex items-center gap-3 mb-4">
                <Banknote className="w-5 h-5 text-emerald-500" />
                <h1 className="text-lg font-bold">{t('title')}</h1>
            </header>
            <p className="text-xs text-[var(--os-text-muted)] mb-4">{t('subtitle')}</p>

            {success && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-semibold text-emerald-600">{t('success.title')}</p>
                        <p className="text-xs text-[var(--os-text-muted)]">{t('success.body', { ref: success.receiptNumber })}</p>
                        <button onClick={() => setSuccess(null)} className="text-[10px] text-emerald-500 mt-1 underline">{t('success.dismiss')}</button>
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-3">
                {/* Shipowner */}
                <Field label={t('field.shipowner')} required>
                    <OsInput
                        value={shipowner ? shipowner.name : shipownerQuery}
                        onChange={(e) => {
                            if (shipowner) setShipowner(null);
                            setShipownerQuery(e.target.value);
                        }}
                        placeholder={t('field.shipownerPlaceholder')}
                    />
                    {!shipowner && shipownerResults.length > 0 && (
                        <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)]">
                            {shipownerResults.map((s) => (
                                <li
                                    key={s.id}
                                    onClick={() => { setShipowner(s); setShipownerQuery(''); setShipownerResults([]); }}
                                    className="px-3 py-1.5 text-xs cursor-pointer hover:bg-[var(--os-surface-3)]"
                                >
                                    {s.name}
                                </li>
                            ))}
                        </ul>
                    )}
                </Field>

                {/* Transaction (optional) */}
                {shipowner && txnResults.length > 0 && (
                    <Field label={t('field.transaction')}>
                        <select
                            value={transaction?.id ?? ''}
                            onChange={(e) => {
                                const tx = txnResults.find((x) => x.id === e.target.value) ?? null;
                                setTransaction(tx);
                                if (tx) setAmount(tx.tax_amount_usd.toFixed(2));
                            }}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] text-[var(--os-text-primary)]"
                        >
                            <option value="">{t('field.transactionNone')}</option>
                            {txnResults.map((tx) => (
                                <option key={tx.id} value={tx.id}>
                                    {tx.invoice_ref ?? tx.id.slice(0, 8)} — ${tx.tax_amount_usd.toFixed(2)}
                                </option>
                            ))}
                        </select>
                    </Field>
                )}

                {/* Amount + currency */}
                <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                        <Field label={t('field.amount')} required>
                            <OsInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                        </Field>
                    </div>
                    <div>
                        <Field label={t('field.currency')}>
                            <OsInput value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} />
                        </Field>
                    </div>
                </div>

                {/* Receipt number */}
                <Field label={t('field.receiptNumber')} required>
                    <div className="flex items-center gap-2">
                        <OsInput value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} />
                        <button
                            type="button"
                            onClick={() => setReceiptNumber(buildAutoReceiptNumber())}
                            className="text-[10px] text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]"
                            title={t('field.regen')}
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </Field>

                {/* Proof upload */}
                <Field label={t('field.proof')}>
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-emerald-500"
                    >
                        <Upload className="w-3.5 h-3.5" />
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
                        <button onClick={() => setProof(null)} className="text-[10px] text-red-500 mt-1">
                            <X className="inline w-3 h-3" /> {t('field.proofRemove')}
                        </button>
                    )}
                </Field>

                {error && <p className="text-xs text-red-500">{error}</p>}

                <div className="flex items-center justify-between mt-2">
                    <OsButton variant="secondary" size="sm" onClick={() => reset(false)} disabled={submitting}>
                        {t('reset')}
                    </OsButton>
                    <OsButton variant="primary" size="sm" onClick={submit} disabled={submitting}>
                        {submitting ? t('submitting') : t('submit')}
                    </OsButton>
                </div>

                <p className="text-[10px] text-[var(--os-text-muted)] mt-2 text-center">
                    {t('fourEyesNote')}
                </p>
            </div>
        </div>
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

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-[var(--os-text-secondary)] uppercase tracking-wide">
                {label} {required && <span className="text-red-500">*</span>}
            </span>
            {children}
        </label>
    );
}
