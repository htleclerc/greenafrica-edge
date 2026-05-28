'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { X, Copy, CheckCircle2, Building2, Hash, CreditCard, FileText } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { ProofUploader } from '@/components/payments/ProofUploader';
import { legacyProofAdapter } from './legacyProofAdapter';

export interface WireTransferInstructions {
    beneficiary: string;
    accountNumber: string;
    beneficiaryAddress: string;
    bank: string;
    swiftCode: string;
    iban: string;
    intermediaryBank: string;
    intermediarySwift: string;
    reference: string;
    amount: string;
    currency: string;
}

interface WireTransferModalProps {
    instructions: WireTransferInstructions;
    invoiceRef: string;
    vesselName: string;
    transactionId: string;
    onClose: () => void;
}

export function WireTransferModal({ instructions, invoiceRef, vesselName, transactionId, onClose }: WireTransferModalProps) {
    const t = useTranslations('InvoicesPage');
    const [copiedField, setCopiedField] = React.useState<string | null>(null);
    const proofAdapter = React.useMemo(() => legacyProofAdapter(transactionId), [transactionId]);

    function copyToClipboard(value: string, field: string) {
        navigator.clipboard.writeText(value).then(() => {
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        });
    }

    const fields = [
        { key: 'beneficiary',      label: 'Beneficiary',         value: instructions.beneficiary,        icon: Building2 },
        { key: 'accountNumber',    label: 'Account No.',         value: instructions.accountNumber,      icon: CreditCard },
        { key: 'beneficiaryAddr',  label: 'Beneficiary Address', value: instructions.beneficiaryAddress, icon: Building2 },
        { key: 'bank',             label: 'Beneficiary Bank',    value: instructions.bank,               icon: Building2 },
        { key: 'swift',            label: 'SWIFT/BIC',           value: instructions.swiftCode,          icon: Hash },
        { key: 'iban',             label: 'IBAN',                value: instructions.iban,               icon: CreditCard },
        { key: 'intermediaryBank', label: 'Intermediary Bank',   value: instructions.intermediaryBank,   icon: Building2 },
        { key: 'intermediarySwift',label: 'Intermediary SWIFT',  value: instructions.intermediarySwift,  icon: Hash },
        { key: 'reference',        label: 'Mandatory Reference', value: instructions.reference,          icon: FileText },
        { key: 'amount',           label: 'Amount',              value: instructions.amount,             icon: CreditCard },
    ];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
            <div
                className="relative w-full max-w-lg mx-4 rounded-2xl border overflow-hidden flex flex-col"
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
                        <h2 className="text-base font-bold text-[var(--os-text-primary)]">Wire Transfer Instructions</h2>
                        <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">
                            {invoiceRef} · {vesselName}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 p-5">
                    <div
                        className="rounded-lg p-3 mb-4"
                        style={{
                            backgroundColor: 'rgba(234,179,8,0.08)',
                            borderLeft: '3px solid #EAB308',
                            color: '#FDE68A',
                            fontSize: '12px',
                            lineHeight: 1.5,
                        }}
                    >
                        <strong>Important:</strong> Use the exact reference below in your wire transfer. Without it, we cannot match your payment to this invoice and your vessel may remain blocked at the port gate.
                    </div>

                    <div className="flex flex-col gap-2.5">
                        {fields.map(({ key, label, value, icon: Icon }) => (
                            <div
                                key={key}
                                className="rounded-xl p-3 flex items-center gap-3"
                                style={{
                                    backgroundColor: 'var(--os-surface-2)',
                                    border: '1px solid var(--os-border)',
                                }}
                            >
                                <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                    style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: '#10B981' }}
                                >
                                    <Icon className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-0.5">
                                        {label}
                                    </p>
                                    <p className="text-sm font-medium text-[var(--os-text-primary)] truncate font-mono">
                                        {value}
                                    </p>
                                </div>
                                <button
                                    onClick={() => copyToClipboard(value, key)}
                                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[var(--os-text-muted)] hover:text-[#10B981] hover:bg-[rgba(16,185,129,0.08)] transition-colors"
                                    title="Copy to clipboard"
                                >
                                    {copiedField === key ? (
                                        <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
                                    ) : (
                                        <Copy className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 rounded-lg p-3" style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">
                            {t('proof_section_title')}
                        </p>
                        <ProofUploader {...proofAdapter} />
                    </div>

                    <div
                        className="rounded-lg p-3 mt-4 text-[11px]"
                        style={{
                            backgroundColor: 'var(--os-surface-2)',
                            color: 'var(--os-text-muted)',
                            lineHeight: 1.5,
                        }}
                    >
                        <p style={{ margin: 0 }}>
                            ▸ Settlement typically takes <strong style={{ color: 'var(--os-text-primary)' }}>1-3 business days</strong> after the wire is initiated by your bank.
                        </p>
                        <p style={{ margin: '6px 0 0' }}>
                            ▸ Once funds are received, your vessel&apos;s compliance status will be updated to <strong style={{ color: '#10B981' }}>COMPLIANT</strong> automatically and you will receive a payment confirmation email.
                        </p>
                        <p style={{ margin: '6px 0 0' }}>
                            ▸ <strong style={{ color: '#EAB308' }}>Proof of payment required</strong> — reply to the issuing email with the SWIFT <strong style={{ color: 'var(--os-text-primary)' }}>MT103</strong> confirmation once the transfer is initiated.
                        </p>
                        <p style={{ margin: '6px 0 0' }}>
                            ▸ For status inquiries, reference: <span style={{ fontFamily: 'monospace', color: '#10B981' }}>{invoiceRef}</span>
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: 'var(--os-border)' }}>
                    <OsButton variant="ghost" size="sm" onClick={onClose}>
                        Close
                    </OsButton>
                    <OsButton
                        variant="primary"
                        size="sm"
                        onClick={() => {
                            const allInstructions = fields.map((f) => `${f.label}: ${f.value}`).join('\n');
                            copyToClipboard(allInstructions, 'all');
                        }}
                    >
                        {copiedField === 'all' ? 'Copied ✓' : 'Copy All Details'}
                    </OsButton>
                </div>
            </div>
        </div>
    );
}
