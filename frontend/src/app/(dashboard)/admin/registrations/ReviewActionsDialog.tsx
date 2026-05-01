'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { approveShipownerRegistration } from '@/actions/approveShipownerRegistration';
import { rejectShipownerRegistration } from '@/actions/rejectShipownerRegistration';
import { requestRegistrationCompletion } from '@/actions/requestRegistrationCompletion';

type Mode = 'approve' | 'reject' | 'request' | null;

export function ReviewActionsDialog({
    shipowner,
    canAction,
    onClose,
    onActionComplete,
}: {
    shipowner: { id: string; name: string; imo_company_no: string };
    canAction: boolean;
    onClose: () => void;
    onActionComplete: () => void;
}) {
    const t = useTranslations('AdminRegistrations');
    const [mode, setMode] = useState<Mode>(null);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function go() {
        setBusy(true);
        setErr(null);
        try {
            if (mode === 'approve') {
                const r = await approveShipownerRegistration({ shipownerId: shipowner.id });
                if (!r.ok) throw new Error(r.message);
            } else if (mode === 'reject') {
                const r = await rejectShipownerRegistration({
                    shipownerId: shipowner.id,
                    reason: text,
                });
                if (!r.ok) throw new Error(r.message);
            } else if (mode === 'request') {
                const r = await requestRegistrationCompletion({
                    shipownerId: shipowner.id,
                    missingItems: text,
                });
                if (!r.ok) throw new Error(r.message);
            }
            onActionComplete();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setBusy(false);
        }
    }

    if (!canAction) {
        return (
            <Dialog.Root open onOpenChange={onClose}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/40" />
                    <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] p-6 max-w-lg w-full shadow-lg">
                        <Dialog.Title className="text-lg font-semibold">{shipowner.name}</Dialog.Title>
                        <p className="text-sm opacity-70 mt-2">IMO: {shipowner.imo_company_no}</p>
                        <p className="mt-4 text-sm text-[var(--os-text-muted)]">
                            {t('view_only')}
                        </p>
                        <div className="flex gap-2 mt-6">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-[var(--os-surface-2)] hover:bg-[var(--os-surface-3)] rounded-lg font-semibold transition-colors"
                            >
                                {t('close')}
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        );
    }

    return (
        <Dialog.Root open onOpenChange={onClose}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/40" />
                <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] p-6 max-w-lg w-full shadow-lg">
                    <Dialog.Close asChild>
                        <button className="absolute top-4 right-4 text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]">
                            <X className="w-5 h-5" />
                        </button>
                    </Dialog.Close>

                    <Dialog.Title className="text-lg font-semibold">{shipowner.name}</Dialog.Title>
                    <p className="text-sm opacity-70 mt-1">IMO: {shipowner.imo_company_no}</p>

                    {!mode && (
                        <div className="grid grid-cols-3 gap-3 mt-6">
                            <button
                                onClick={() => setMode('approve')}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
                            >
                                {t('actions.approve')}
                            </button>
                            <button
                                onClick={() => setMode('request')}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold transition-colors"
                            >
                                {t('actions.request_completion')}
                            </button>
                            <button
                                onClick={() => setMode('reject')}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
                            >
                                {t('actions.reject')}
                            </button>
                        </div>
                    )}

                    {mode && mode !== 'approve' && (
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            className="mt-4 w-full px-3 py-2 bg-[var(--os-surface-2)] border border-[var(--os-border)] rounded-lg text-[var(--os-text-primary)] placeholder-[var(--os-text-muted)] resize-none"
                            rows={4}
                            placeholder={t(`placeholders.${mode}`)}
                        />
                    )}

                    {err && <div className="mt-3 text-sm text-red-400">{err}</div>}

                    {mode && (
                        <div className="flex gap-2 mt-6">
                            <button
                                onClick={go}
                                disabled={busy}
                                className="px-4 py-2 bg-[var(--os-highlight)] hover:bg-[var(--os-highlight)]/90 disabled:opacity-50 text-[var(--os-text-primary)] rounded-lg font-semibold transition-colors"
                            >
                                {busy ? t('submitting') : t('confirm')}
                            </button>
                            <button
                                onClick={() => setMode(null)}
                                className="px-4 py-2 bg-[var(--os-surface-2)] hover:bg-[var(--os-surface-3)] rounded-lg font-semibold transition-colors"
                            >
                                {t('back')}
                            </button>
                        </div>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
