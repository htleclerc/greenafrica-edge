'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { verifyMfaChallenge } from '@/actions/verifyMfaChallenge';
import { createClient } from '@/lib/supabase/client';

/**
 * Écran d'élévation : la session est ouverte, le second facteur reste à franchir.
 *
 * Il porte une sortie explicite vers la déconnexion. Sans elle, quelqu'un ayant
 * perdu son téléphone resterait bloqué sur cette page à chaque visite, sans
 * même pouvoir se déconnecter pour essayer un autre compte.
 */
export function MfaChallenge({ redirectTo }: { redirectTo: string }) {
    const t = useTranslations('Mfa');
    const router = useRouter();
    const [code, setCode] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [pending, startTransition] = React.useTransition();

    function submit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const r = await verifyMfaChallenge({ code });
            if (!r.ok) { setError(t('invalid')); setCode(''); return; }
            // `replace` et non `push` : revenir en arrière sur un écran de
            // vérification déjà franchi n'a pas de sens.
            router.replace(redirectTo);
            router.refresh();
        });
    }

    async function signOut() {
        await createClient().auth.signOut();
        router.replace('/login');
        router.refresh();
    }

    return (
        <main className="flex min-h-screen items-center justify-center p-6" style={{ backgroundColor: 'var(--os-bg)' }}>
            <form
                onSubmit={submit}
                className="flex w-full max-w-sm flex-col gap-5 rounded-2xl p-6"
                style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
            >
                <div className="flex flex-col gap-2">
                    <ShieldCheck className="size-6" style={{ color: 'var(--os-brand-green)' }} aria-hidden />
                    <h1 className="text-lg font-bold" style={{ color: 'var(--os-text-primary)' }}>{t('title')}</h1>
                    <p className="text-sm" style={{ color: 'var(--os-text-muted)' }}>{t('subtitle')}</p>
                </div>

                <label className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--os-text-muted)' }}>
                        {t('code')}
                    </span>
                    <input
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        autoFocus
                        className="h-12 rounded-xl px-3 text-center font-mono text-2xl tracking-[0.4em] outline-none"
                        style={{
                            backgroundColor: 'var(--os-surface-2)',
                            border: '1px solid var(--os-border)',
                            color: 'var(--os-text-primary)',
                        }}
                    />
                </label>

                {error && <p className="text-xs" style={{ color: 'var(--os-red)' }}>{error}</p>}

                <button
                    type="submit"
                    disabled={pending || code.length !== 6}
                    className="h-11 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ backgroundColor: 'var(--os-brand-green)', color: 'var(--os-on-primary)' }}
                >
                    {t('submit')}
                </button>

                <button
                    type="button"
                    onClick={signOut}
                    className="text-center text-xs underline"
                    style={{ color: 'var(--os-text-muted)' }}
                >
                    {t('lost')}
                </button>
            </form>
        </main>
    );
}
