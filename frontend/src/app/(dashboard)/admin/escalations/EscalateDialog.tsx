'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Ship } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { escalateToOwner } from '@/actions/escalateToOwner';
import type { UnpaidProforma } from '@/services/escalationService';

interface Props {
    row: UnpaidProforma;
    open: boolean;
    onClose: () => void;
}

export function EscalateDialog({ row, open, onClose }: Props) {
    const t = useTranslations('AdminEscalations.dialog');
    const prefilled = row.shipownerOfficialEmail ?? '';
    const [email, setEmail] = React.useState(prefilled);
    const [locale, setLocale] = React.useState<'en' | 'fr'>('en');
    const [error, setError] = React.useState<string | null>(null);
    const [pending, startTransition] = React.useTransition();

    const trimmed = email.trim();
    const ownerEmailIsNew = trimmed.length > 0 && trimmed !== prefilled;

    function submit() {
        if (!trimmed.includes('@') || trimmed.length < 5) {
            setError(t('ownerEmailLabel'));
            return;
        }
        setError(null);
        startTransition(async () => {
            const result = await escalateToOwner({
                transactionId: row.transactionId,
                ownerEmail: trimmed,
                ownerEmailIsNew,
                locale,
            });
            if (!result.ok) {
                setError(result.reason);
                return;
            }
            onClose();
        });
    }

    return (
        <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className="fixed inset-0 z-50"
                    style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
                />
                <Dialog.Content
                    className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg mx-4 rounded-2xl border overflow-hidden flex flex-col"
                    style={{
                        backgroundColor: 'var(--os-surface)',
                        borderColor: 'var(--os-border-strong)',
                        maxHeight: '85vh',
                    }}
                >
                    {/* Header */}
                    <div
                        className="flex items-center justify-between px-5 py-3 border-b"
                        style={{ borderColor: 'var(--os-border)' }}
                    >
                        <div className="min-w-0">
                            <Dialog.Title className="text-sm font-bold text-[var(--os-text-primary)]">
                                {t('title')}
                            </Dialog.Title>
                            <Dialog.Description className="text-[10px] text-[var(--os-text-muted)] truncate">
                                {t('description', { vessel: row.vesselName, imo: row.vesselImo })}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button
                                disabled={pending}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors disabled:opacity-50"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </Dialog.Close>
                    </div>

                    {/* Body */}
                    <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
                        <div className="flex items-center gap-2 text-xs text-[var(--os-text-secondary)]">
                            <Ship className="w-3.5 h-3.5 text-[#00D97E]" />
                            <span className="font-mono">{row.vesselImo}</span>
                            <span className="opacity-40">·</span>
                            <span className="font-mono">{row.transactionRef ?? row.transactionId.slice(0, 8)}</span>
                            <span className="opacity-40">·</span>
                            <span>
                                {row.taxAmountUsd.toLocaleString('en-US', {
                                    style: 'currency',
                                    currency: 'USD',
                                })}
                            </span>
                        </div>

                        <OsInput
                            type="email"
                            label={t('ownerEmailLabel')}
                            placeholder="ops@owner-company.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={pending}
                            error={error ?? undefined}
                            hint={ownerEmailIsNew ? t('ownerEmailNewHint') : undefined}
                        />

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                                {t('localeLabel')}
                            </label>
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 cursor-pointer text-sm text-[var(--os-text-primary)]">
                                    <input
                                        type="radio"
                                        name="locale"
                                        value="en"
                                        checked={locale === 'en'}
                                        onChange={() => setLocale('en')}
                                        disabled={pending}
                                        className="accent-[#00D97E]"
                                    />
                                    EN
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer text-sm text-[var(--os-text-primary)]">
                                    <input
                                        type="radio"
                                        name="locale"
                                        value="fr"
                                        checked={locale === 'fr'}
                                        onChange={() => setLocale('fr')}
                                        disabled={pending}
                                        className="accent-[#00D97E]"
                                    />
                                    FR
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div
                        className="px-5 py-3 border-t flex items-center justify-end gap-2"
                        style={{ borderColor: 'var(--os-border)' }}
                    >
                        <OsButton variant="ghost" size="sm" onClick={onClose} disabled={pending}>
                            {t('cancel')}
                        </OsButton>
                        <OsButton
                            variant="primary"
                            size="sm"
                            onClick={submit}
                            loading={pending}
                            disabled={pending}
                        >
                            {pending ? t('sending') : t('confirm')}
                        </OsButton>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
