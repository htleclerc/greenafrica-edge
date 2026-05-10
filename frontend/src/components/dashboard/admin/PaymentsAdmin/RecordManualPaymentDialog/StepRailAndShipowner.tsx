'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { useRecordPayment, type AdminRail, type ShipownerOption, type TransactionOption } from './useRecordPaymentContext';

const RAILS: AdminRail[] = ['CASH', 'CHEQUE', 'LETTER_OF_CREDIT', 'NETTING', 'THIRD_PARTY', 'BANK_GUARANTEE'];

export function StepRailAndShipowner() {
    const t = useTranslations('AdminPayments.recordDialog');
    const ctx = useRecordPayment();
    const [shipownerQuery, setShipownerQuery] = React.useState('');
    const [shipownerResults, setShipownerResults] = React.useState<ShipownerOption[]>([]);
    const [txnResults, setTxnResults] = React.useState<TransactionOption[]>([]);

    // Search shipowners by name (debounced)
    React.useEffect(() => {
        if (shipownerQuery.length < 2) { setShipownerResults([]); return; }
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
    }, [shipownerQuery]);

    // Load shipowner's open transactions when selected
    React.useEffect(() => {
        if (!ctx.shipowner) { setTxnResults([]); return; }
        (async () => {
            const url = new URL('/api/admin/shipowners/' + ctx.shipowner!.id + '/open-transactions', window.location.origin);
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                setTxnResults(data.transactions ?? []);
            }
        })();
    }, [ctx.shipowner]);

    function next() {
        if (!ctx.rail)        { ctx.setError(t('errors.railRequired')); return; }
        if (!ctx.shipowner)   { ctx.setError(t('errors.shipownerRequired')); return; }
        // Transaction is optional (e.g. wallet top-up not tied to invoice — but admin-only rails generally do tie)
        ctx.setError(null);
        ctx.setStep('params');
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--os-text-muted)]">{t('step1.intro')}</p>

            {/* Rail picker */}
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                    {t('step1.rail')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                    {RAILS.map((r) => {
                        const selected = ctx.rail === r;
                        return (
                            <button
                                key={r}
                                onClick={() => ctx.setRail(r)}
                                className="text-xs font-mono p-2 rounded-lg border transition-colors text-left"
                                style={{
                                    borderColor: selected ? '#38BDF8' : 'var(--os-border)',
                                    backgroundColor: selected ? 'rgba(56,189,248,0.10)' : 'var(--os-surface-2)',
                                    color: selected ? '#38BDF8' : 'var(--os-text-primary)',
                                }}
                            >
                                {r}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Shipowner autocomplete */}
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                    {t('step1.shipowner')}
                </p>
                <OsInput
                    value={ctx.shipowner ? ctx.shipowner.name : shipownerQuery}
                    onChange={(e) => {
                        if (ctx.shipowner) ctx.setShipowner(null);
                        setShipownerQuery(e.target.value);
                    }}
                    placeholder={t('step1.shipownerPlaceholder')}
                />
                {!ctx.shipowner && shipownerResults.length > 0 && (
                    <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)]">
                        {shipownerResults.map((s) => (
                            <li
                                key={s.id}
                                onClick={() => { ctx.setShipowner(s); setShipownerQuery(''); setShipownerResults([]); }}
                                className="px-3 py-1.5 text-xs cursor-pointer hover:bg-[var(--os-surface-3)]"
                            >
                                {s.name}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Transaction picker (optional) */}
            {ctx.shipowner && txnResults.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                        {t('step1.transaction')}
                    </p>
                    <select
                        value={ctx.transaction?.id ?? ''}
                        onChange={(e) => {
                            const tx = txnResults.find((x) => x.id === e.target.value) ?? null;
                            ctx.setTransaction(tx);
                            if (tx) {
                                ctx.setAmount(tx.tax_amount_usd.toFixed(2));
                                ctx.setCurrency('USD');
                            }
                        }}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] text-[var(--os-text-primary)]"
                    >
                        <option value="">{t('step1.transactionNone')}</option>
                        {txnResults.map((tx) => (
                            <option key={tx.id} value={tx.id}>
                                {tx.invoice_ref ?? tx.id.slice(0, 8)} — ${tx.tax_amount_usd.toFixed(2)}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {ctx.error && <p className="text-xs text-[#EF4444]">{ctx.error}</p>}

            <div className="flex justify-end">
                <OsButton variant="primary" size="sm" onClick={next}>{t('next')}</OsButton>
            </div>
        </div>
    );
}
