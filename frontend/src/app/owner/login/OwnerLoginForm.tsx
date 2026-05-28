'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';

// Only allow same-portal redirect targets to avoid open-redirect.
function safeOwnerRedirect(raw: string | null): string {
    return raw && raw.startsWith('/owner/') ? raw : '/owner/dashboard';
}

export function OwnerLoginForm() {
    const t = useTranslations('OwnerPortal.login');
    const router = useRouter();
    const params = useSearchParams();
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [pending, setPending] = React.useState<null | 'password' | 'link' | 'reset'>(null);
    const [sentTo, setSentTo] = React.useState<string | null>(null);
    const [resetSent, setResetSent] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const cleanEmail = () => email.trim().toLowerCase();

    async function signInPassword(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setPending('password');
        try {
            const supabase = createClient();
            const { error: err } = await supabase.auth.signInWithPassword({ email: cleanEmail(), password });
            if (err) {
                setError(t('errors.invalidCredentials'));
                return;
            }
            router.push(safeOwnerRedirect(params.get('redirectTo')));
        } catch {
            setError(t('errors.generic'));
        } finally {
            setPending(null);
        }
    }

    async function sendMagicLink() {
        setError(null);
        setPending('link');
        try {
            const supabase = createClient();
            const appUrl = window.location.origin;
            const { error: err } = await supabase.auth.signInWithOtp({
                email: cleanEmail(),
                options: { emailRedirectTo: `${appUrl}/owner/auth/callback`, shouldCreateUser: false },
            });
            // Anti-enumeration: never surface whether the email exists or any provider
            // error to the UI. Always show the generic "link sent" confirmation. Log
            // real errors server-side-style for debugging only.
            if (err) {
                console.warn('[owner login] magic-link request error (suppressed for anti-enumeration):', err.message);
            }
            setSentTo(email);
        } catch {
            setError(t('errors.generic'));
        } finally {
            setPending(null);
        }
    }

    async function sendReset() {
        setError(null);
        setPending('reset');
        try {
            const supabase = createClient();
            const appUrl = window.location.origin;
            await supabase.auth.resetPasswordForEmail(cleanEmail(), {
                redirectTo: `${appUrl}/owner/reset-password`,
            });
            setResetSent(true);
        } catch {
            setResetSent(true);
        } finally {
            setPending(null);
        }
    }

    if (sentTo) {
        return (
            <div className="px-3 py-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.35)', color: '#86EFAC' }}>
                {t.rich('linkSent', { email: sentTo, strong: (chunks) => <strong>{chunks}</strong> })}
            </div>
        );
    }

    if (resetSent) {
        return (
            <div className="px-3 py-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.35)', color: '#86EFAC' }}>
                {t('resetSent')}
            </div>
        );
    }

    return (
        <form onSubmit={signInPassword} className="flex flex-col gap-4">
            <OsInput
                label={t('emailLabel')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@example.com"
                required
                autoFocus
            />
            <OsInput
                label={t('passwordLabel')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                error={error ?? undefined}
            />
            <p className="text-[11px] text-[var(--os-text-muted)]">{t('noPasswordHint')}</p>

            <OsButton type="submit" variant="primary" loading={pending === 'password'} disabled={pending !== null || !email || !password}>
                {pending === 'password' ? t('signingIn') : t('passwordSubmit')}
            </OsButton>

            <div className="flex flex-col gap-2 pt-1 border-t border-[var(--os-border)]">
                <button type="button" onClick={sendMagicLink} disabled={pending !== null || !email} className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50 text-left">
                    {pending === 'link' ? t('sending') : t('useMagicLink')}
                </button>
                <button type="button" onClick={sendReset} disabled={pending !== null || !email} className="text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] disabled:opacity-50 text-left">
                    {t('setPassword')}
                </button>
            </div>
        </form>
    );
}
