'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Plus, Upload } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { useTransactions } from '@/hooks/useTransactions';
import { useDisputes } from '@/hooks/useDisputes';
import { TransactionStatus, DisputeReason } from '@/types/secure';

interface DisputeFormModalProps {
    onClose: () => void;
    preselectedTransactionId?: string;
}

export function DisputeFormModal({ onClose, preselectedTransactionId }: DisputeFormModalProps) {
    const t = useTranslations('Disputes');
    const { data: transactions } = useTransactions();
    const { data: disputes } = useDisputes();

    // Transactions that can be disputed: PENDING or OVERDUE and not already disputed
    const disputedTxnIds = new Set(disputes.map((d) => d.transactionId));
    const eligibleTransactions = transactions.filter(
        (tx) =>
            (tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.OVERDUE) &&
            !disputedTxnIds.has(tx.id),
    );

    const [selectedTxnId, setSelectedTxnId] = React.useState(preselectedTransactionId ?? '');
    const [reason, setReason]               = React.useState<DisputeReason | ''>('');
    const [description, setDescription]     = React.useState('');
    const [evidenceUrl, setEvidenceUrl]     = React.useState('');

    const REASON_OPTIONS: { value: DisputeReason; label: string }[] = [
        { value: DisputeReason.EMISSION_CALCULATION, label: t('reason_emission') },
        { value: DisputeReason.TAX_RATE,             label: t('reason_tax_rate') },
        { value: DisputeReason.ZONE_CLASSIFICATION,  label: t('reason_zone') },
        { value: DisputeReason.VESSEL_DATA,          label: t('reason_vessel_data') },
        { value: DisputeReason.OTHER,                label: t('reason_other') },
    ];

    const canSubmit = selectedTxnId !== '' && reason !== '' && description.trim().length > 10;

    function handleSubmit() {
        // In a real implementation this would call the dispute service
        // For now, just close the modal
        onClose();
    }

    return (
        <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
                <Dialog.Content
                    className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg mx-4 rounded-2xl border overflow-hidden flex flex-col"
                    style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)', maxHeight: '85vh' }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--os-border)' }}>
                        <div>
                            <Dialog.Title className="text-sm font-bold text-[var(--os-text-primary)]">
                                {t('new_dispute_title')}
                            </Dialog.Title>
                            <Dialog.Description className="text-[10px] text-[var(--os-text-muted)]">
                                {t('new_dispute_subtitle')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </Dialog.Close>
                    </div>

                    {/* Form body */}
                    <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
                        {/* Transaction select */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5 block">
                                {t('select_transaction')}
                            </label>
                            <select
                                value={selectedTxnId}
                                onChange={(e) => setSelectedTxnId(e.target.value)}
                                className="w-full h-9 px-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/50 transition-colors"
                            >
                                <option value="">{t('select_transaction_placeholder')}</option>
                                {eligibleTransactions.map((tx) => (
                                    <option key={tx.id} value={tx.id}>
                                        {tx.ref} — {tx.vesselName} — ${tx.taxAmountUsd.toLocaleString()}
                                    </option>
                                ))}
                            </select>
                            {eligibleTransactions.length === 0 && (
                                <p className="text-[10px] text-[#F59E0B] mt-1">{t('no_eligible_transactions')}</p>
                            )}
                        </div>

                        {/* Reason select */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5 block">
                                {t('dispute_reason')}
                            </label>
                            <select
                                value={reason}
                                onChange={(e) => setReason(e.target.value as DisputeReason)}
                                className="w-full h-9 px-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/50 transition-colors"
                            >
                                <option value="">{t('select_reason_placeholder')}</option>
                                {REASON_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Description */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5 block">
                                {t('description')}
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t('description_placeholder')}
                                rows={4}
                                className="w-full px-3 py-2 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/50 transition-colors resize-none"
                            />
                            <p className="text-[10px] text-[var(--os-text-muted)] mt-1">
                                {t('min_characters', { count: 10 })}
                            </p>
                        </div>

                        {/* Evidence URL */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5 block">
                                {t('evidence_url')}
                            </label>
                            <div className="relative">
                                <Upload className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                                <input
                                    value={evidenceUrl}
                                    onChange={(e) => setEvidenceUrl(e.target.value)}
                                    placeholder={t('evidence_url_placeholder')}
                                    type="url"
                                    className="w-full h-9 pl-9 pr-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/50 transition-colors"
                                />
                            </div>
                            <p className="text-[10px] text-[var(--os-text-muted)] mt-1">{t('evidence_optional')}</p>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--os-border)' }}>
                        <OsButton variant="ghost" size="sm" onClick={onClose}>{t('cancel')}</OsButton>
                        <OsButton
                            variant="primary"
                            size="sm"
                            icon={<Plus className="w-3.5 h-3.5" />}
                            disabled={!canSubmit}
                            onClick={handleSubmit}
                        >
                            {t('submit_dispute')}
                        </OsButton>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
