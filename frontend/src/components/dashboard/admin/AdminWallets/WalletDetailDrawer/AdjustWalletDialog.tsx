'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';
import { AlertTriangle } from 'lucide-react';
import { adjustWalletManually } from '@/actions/adjustWalletManually';

interface Props {
    walletId: string;
    shipownerName: string;
    currentBalanceUsdMinor: number;
    onClose: (refresh: boolean) => void;
}

export function AdjustWalletDialog({ walletId, shipownerName, currentBalanceUsdMinor, onClose }: Props) {
    const t = useTranslations('AdminWallets.adjust');
    const [amount, setAmount] = React.useState('');
    const [direction, setDirection] = React.useState<'+' | '−'>('+');
    const [justification, setJustification] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    async function submit() {
        setError(null);
        if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount)) {
            setError(t('errors.amountInvalid'));
            return;
        }
        if (justification.trim().length < 5) {
            setError(t('errors.justificationRequired'));
            return;
        }
        const signed = (direction === '+' ? 1 : -1) * Math.round(parseFloat(amount) * 100);
        if (direction === '−' && Math.abs(signed) > currentBalanceUsdMinor) {
            setError(t('errors.wouldGoNegative'));
            return;
        }
        setSubmitting(true);
        try {
            await adjustWalletManually({ walletId, amountSignedMinor: signed, justification: justification.trim() });
            onClose(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('errors.failed'));
            setSubmitting(false);
        }
    }

    return (
        <Dialog.Root open={true} onOpenChange={(o) => !o && onClose(false)}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                >
                    <Dialog.Title className="text-base font-semibold mb-1">
                        {t('title', { owner: shipownerName })}
                    </Dialog.Title>
                    <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-4">
                        {t('subtitle')}
                    </Dialog.Description>

                    <div className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-200">{t('warning')}</p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                type="button"
                                onClick={() => setDirection('+')}
                                className="px-3 py-2 rounded-lg border text-sm font-bold"
                                style={{
                                    borderColor: direction === '+' ? '#10B981' : 'var(--os-border)',
                                    backgroundColor: direction === '+' ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                    color: direction === '+' ? '#10B981' : 'var(--os-text-muted)',
                                }}
                            >
                                + {t('credit')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDirection('−')}
                                className="px-3 py-2 rounded-lg border text-sm font-bold"
                                style={{
                                    borderColor: direction === '−' ? '#F59E0B' : 'var(--os-border)',
                                    backgroundColor: direction === '−' ? 'rgba(245,158,11,0.12)' : 'var(--os-surface-2)',
                                    color: direction === '−' ? '#F59E0B' : 'var(--os-text-muted)',
                                }}
                            >
                                − {t('debit')}
                            </button>
                            <div></div>
                        </div>

                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                                {t('amount')} (USD)
                            </span>
                            <OsInput
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="100.00"
                                inputMode="decimal"
                            />
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                                {t('justification')}
                            </span>
                            <textarea
                                value={justification}
                                onChange={(e) => setJustification(e.target.value)}
                                rows={3}
                                className="px-3 py-2 text-xs rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] resize-none text-[var(--os-text-primary)]"
                                placeholder={t('justificationPlaceholder')}
                            />
                        </label>

                        {error && <p className="text-xs text-red-500">{error}</p>}

                        <div className="flex items-center justify-between mt-2">
                            <OsButton variant="secondary" size="sm" onClick={() => onClose(false)} disabled={submitting}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton variant="primary" size="sm" onClick={submit} disabled={submitting}>
                                {submitting ? t('submitting') : t('submit')}
                            </OsButton>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
