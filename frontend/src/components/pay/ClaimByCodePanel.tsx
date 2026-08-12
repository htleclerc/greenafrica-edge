'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Mail, KeyRound } from 'lucide-react';
import { requestVesselAccessCode, type RequestAccessCodeResult } from '@/actions/requestVesselAccessCode';
import { verifyVesselAccessCode, type VerifyAccessCodeResult } from '@/actions/verifyVesselAccessCode';

type SendFailureReason = Extract<RequestAccessCodeResult, { ok: false }>['reason'];
type VerifyFailureReason = Extract<VerifyAccessCodeResult, { ok: false }>['reason'];

// Mappages exhaustifs raison → clé i18n. Écrits en switch sans `default` : si
// une raison est un jour ajoutée côté action, TypeScript refuse de compiler
// tant que ce fichier n'a pas été mis à jour — pas de repli silencieux sur
// « code incorrect » pour une raison en réalité non gérée.
function sendErrorKey(reason: SendFailureReason): string {
    switch (reason) {
        case 'rate_limited':
            return 'claim_error_rate_limited';
        case 'invalid_identifier':
            return 'claim_error_invalid_identifier';
        case 'not_claimable':
            return 'claim_error_not_claimable';
        case 'send_failed':
            return 'claim_error_send_failed';
    }
}

function verifyErrorKey(reason: VerifyFailureReason): string {
    switch (reason) {
        case 'invalid_code':
            return 'claim_error_invalid_code';
        case 'rate_limited':
            return 'claim_error_rate_limited';
        case 'invalid_identifier':
            return 'claim_error_invalid_identifier';
        case 'not_claimable':
            return 'claim_error_not_claimable';
        case 'activation_failed':
            return 'claim_error_activation_failed';
    }
}

/**
 * Branche A du rattachement : code envoyé à l'adresse déjà enregistrée.
 *
 * Le composant n'affiche jamais d'adresse complète — seulement l'indice masqué
 * calculé côté serveur. Il ne propose pas non plus de saisir une adresse : le
 * destinataire du code vient de la base, jamais de l'écran.
 */
export function ClaimByCodePanel({ identifier }: { identifier: string }) {
    const t = useTranslations('VesselLookup');
    const router = useRouter();

    const [hint, setHint] = React.useState<string | null>(null);
    const [code, setCode] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [pending, setPending] = React.useState(false);

    async function onSend() {
        setPending(true);
        setError(null);
        const r = await requestVesselAccessCode({ identifier });
        setPending(false);
        if (r.ok) {
            setHint(r.emailHint);
            return;
        }
        setError(t(sendErrorKey(r.reason)));
    }

    async function onVerify(e: React.FormEvent) {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await verifyVesselAccessCode({ identifier, code });
        setPending(false);
        if (r.ok) {
            router.push(r.redirectTo);
            return;
        }
        setError(t(verifyErrorKey(r.reason)));
    }

    return (
        <section className="os-card p-8 max-w-md mx-auto">
            <h1 className="text-xl font-semibold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                {t('claim_title')}
            </h1>

            {hint === null ? (
                <>
                    <p className="text-sm mb-6 flex items-start gap-2" style={{ color: 'var(--ais-page-text-muted)' }}>
                        <Mail className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                        {t('claim_code_intro')}
                    </p>
                    <button
                        type="button"
                        onClick={onSend}
                        disabled={pending}
                        className="w-full px-6 py-3 rounded-xl font-semibold bg-emerald-600
                                   hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                        style={{ color: '#FFFFFF' }}
                    >
                        {t('claim_code_send')}
                    </button>
                </>
            ) : (
                <form onSubmit={onVerify}>
                    <p className="text-sm mb-1" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('claim_code_sent')}
                    </p>
                    <p className="text-sm font-mono mb-6" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('claim_code_hint', { hint })}
                    </p>

                    <label htmlFor="claim-code" className="block text-sm mb-2" style={{ color: 'var(--ais-page-text-secondary)' }}>
                        {t('claim_code_label')}
                    </label>
                    <input
                        id="claim-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        className="w-full px-4 py-3 rounded-xl mb-4 font-mono tracking-[0.4em] text-center"
                        style={{
                            color: 'var(--ais-page-text)',
                            border: '1px solid var(--ais-page-border)',
                            backgroundColor: 'var(--ais-page-surface)',
                        }}
                    />

                    <button
                        type="submit"
                        disabled={pending || code.length < 4}
                        className="w-full px-6 py-3 rounded-xl font-semibold bg-emerald-600
                                   hover:bg-emerald-500 disabled:opacity-50 transition-colors
                                   flex items-center justify-center gap-2"
                        style={{ color: '#FFFFFF' }}
                    >
                        <KeyRound className="w-4 h-4" aria-hidden="true" />
                        {t('claim_code_submit')}
                    </button>

                    <button
                        type="button"
                        onClick={onSend}
                        disabled={pending}
                        className="w-full mt-3 text-sm text-emerald-400 hover:underline disabled:opacity-50"
                    >
                        {t('claim_code_resend')}
                    </button>
                </form>
            )}

            {error && (
                <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>
            )}
        </section>
    );
}
