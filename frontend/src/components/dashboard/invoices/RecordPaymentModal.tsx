'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { X, CheckCircle2, Building2, CreditCard, Smartphone, Banknote, MoreHorizontal, Briefcase } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';

export interface RecordPaymentInput {
    paymentMethod: PaymentMethod;
    paymentReference: string;
    paymentNotes: string;
}

export type PaymentMethod =
    | 'wire_transfer'
    | 'cash'
    | 'mobile_money'
    | 'card'
    | 'stripe'
    | 'paystack'
    | 'flutterwave'
    | 'wave'
    | 'payoneer'
    | 'other';

interface MethodOption {
    key: PaymentMethod;
    label: string;
    sublabel: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
}

const METHOD_OPTIONS: MethodOption[] = [
    {
        key: 'wire_transfer',
        label: 'Wire Transfer',
        sublabel: 'SWIFT / SEPA bank wire',
        icon: Building2,
        color: '#10B981',
    },
    {
        key: 'cash',
        label: 'Cash',
        sublabel: 'Physical cash deposit',
        icon: Banknote,
        color: '#EAB308',
    },
    {
        key: 'mobile_money',
        label: 'Mobile Money',
        sublabel: 'Wave, MPesa, Orange Money',
        icon: Smartphone,
        color: '#38BDF8',
    },
    {
        key: 'card',
        label: 'Card',
        sublabel: 'POS / manual card swipe',
        icon: CreditCard,
        color: '#A78BFA',
    },
    {
        key: 'payoneer',
        label: 'Payoneer',
        sublabel: 'B2B cross-border (USD/EUR/GBP)',
        icon: Briefcase,
        color: '#FF4800',
    },
    {
        key: 'other',
        label: 'Other',
        sublabel: 'Specify in notes',
        icon: MoreHorizontal,
        color: '#94A3B8',
    },
];

interface RecordPaymentModalProps {
    invoiceRef: string;
    vesselName: string;
    amountUsd: number;
    isLoading: boolean;
    error: string | null;
    onConfirm: (input: RecordPaymentInput) => void;
    onClose: () => void;
    transactionId?: string;
    proofFiles?: { path: string }[];
}

export function RecordPaymentModal({
    invoiceRef,
    vesselName,
    amountUsd,
    isLoading,
    error,
    onConfirm,
    onClose,
    transactionId,
    proofFiles,
}: RecordPaymentModalProps) {
    const t = useTranslations('InvoicesPage');
    const [method, setMethod]       = React.useState<PaymentMethod>('wire_transfer');
    const [reference, setReference] = React.useState('');
    const [notes, setNotes]         = React.useState('');

    function handleSubmit() {
        onConfirm({
            paymentMethod: method,
            paymentReference: reference,
            paymentNotes: notes,
        });
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
            <div
                className="relative w-full max-w-md mx-4 rounded-2xl border overflow-hidden flex flex-col"
                style={{
                    backgroundColor: 'var(--os-surface)',
                    borderColor: 'var(--os-border-strong)',
                    maxHeight: '90vh',
                }}
            >
                {/* Top accent bar */}
                <div style={{ height: '4px', background: 'linear-gradient(90deg, #047857 0%, #10B981 50%, #EAB308 100%)' }} />

                {/* Header */}
                <div className="flex items-start justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--os-border)' }}>
                    <div>
                        <h2 className="text-base font-bold text-[var(--os-text-primary)]">Record Payment</h2>
                        <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">
                            {invoiceRef} · {vesselName} · ${amountUsd.toLocaleString()}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors disabled:opacity-50"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 p-5">
                    {/* Legacy payment proofs — review before validating the wire */}
                    {transactionId && proofFiles && proofFiles.length > 0 && (
                        <div className="mb-4 p-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)]">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">
                                {t('proof_submitted_label', { count: proofFiles.length })}
                            </p>
                            <div className="flex flex-col gap-1">
                                {proofFiles.map((f, i) => (
                                    <button
                                        key={f.path}
                                        onClick={async () => {
                                            const res = await fetch(`/api/transactions/${transactionId}/proof/${i}`);
                                            if (res.ok) window.open((await res.json()).url, '_blank', 'noopener');
                                        }}
                                        className="text-left text-xs text-emerald-400 hover:underline"
                                    >
                                        {f.path.split('/').pop()}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Method picker */}
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">
                        Payment Method
                    </p>
                    <div className="flex flex-col gap-2 mb-4">
                        {METHOD_OPTIONS.map(({ key, label, sublabel, icon: Icon, color }) => {
                            const isActive = method === key;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setMethod(key)}
                                    disabled={isLoading}
                                    className="flex items-center gap-3 p-3 rounded-xl border transition-all text-left disabled:opacity-50"
                                    style={{
                                        backgroundColor: isActive ? `${color}10` : 'var(--os-surface-2)',
                                        borderColor: isActive ? `${color}50` : 'var(--os-border)',
                                    }}
                                >
                                    <div
                                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                                        style={{ backgroundColor: `${color}18`, color }}
                                    >
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p
                                            className="text-xs font-semibold"
                                            style={{ color: isActive ? color : 'var(--os-text-primary)' }}
                                        >
                                            {label}
                                        </p>
                                        <p className="text-[10px] text-[var(--os-text-muted)] truncate">
                                            {sublabel}
                                        </p>
                                    </div>
                                    {isActive && (
                                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color }} />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Reference */}
                    <div className="mb-4">
                        <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] block mb-1.5">
                            Bank / Provider Reference
                            <span className="text-[var(--os-text-dim)] font-normal normal-case ml-1">(optional but recommended)</span>
                        </label>
                        <input
                            type="text"
                            value={reference}
                            onChange={(e) => setReference(e.target.value)}
                            disabled={isLoading}
                            placeholder="e.g. SWIFT MT103/2026/04/12-7842"
                            className="w-full h-10 px-3 rounded-xl text-sm font-mono bg-[var(--os-surface-2)] border border-[var(--os-border)] text-[var(--os-text-primary)] placeholder:text-[var(--os-text-dim)] focus:outline-none focus:border-[#10B981]/50 disabled:opacity-50"
                        />
                        <p className="text-[10px] text-[var(--os-text-muted)] mt-1">
                            This appears in the audit trail and the receipt PDF.
                        </p>
                    </div>

                    {/* Notes */}
                    <div className="mb-2">
                        <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] block mb-1.5">
                            Notes
                            <span className="text-[var(--os-text-dim)] font-normal normal-case ml-1">(optional)</span>
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            disabled={isLoading}
                            rows={3}
                            placeholder="Any context for the audit log — e.g. 'Wire received 2026-04-12, partial payment, balance pending'"
                            className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--os-surface-2)] border border-[var(--os-border)] text-[var(--os-text-primary)] placeholder:text-[var(--os-text-dim)] focus:outline-none focus:border-[#10B981]/50 resize-none disabled:opacity-50"
                        />
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="p-3 rounded-xl text-[11px] text-[#EF4444] bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: 'var(--os-border)' }}>
                    <OsButton variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
                        Cancel
                    </OsButton>
                    <OsButton
                        variant="primary"
                        size="sm"
                        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        onClick={handleSubmit}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Recording…' : 'Confirm Payment'}
                    </OsButton>
                </div>
            </div>
        </div>
    );
}
