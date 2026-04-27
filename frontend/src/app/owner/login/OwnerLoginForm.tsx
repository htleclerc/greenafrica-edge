'use client';

import * as React from 'react';
import { createClient } from '@/lib/supabase/client';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';

export function OwnerLoginForm() {
    const [email, setEmail] = React.useState('');
    const [pending, setPending] = React.useState(false);
    const [sentTo, setSentTo] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setPending(true);

        try {
            const supabase = createClient();
            const appUrl = window.location.origin;
            const { error: otpErr } = await supabase.auth.signInWithOtp({
                email: email.trim().toLowerCase(),
                options: {
                    emailRedirectTo: `${appUrl}/owner/auth/callback`,
                    // shouldCreateUser=false: only owners that have been invited
                    // (their auth.users row already exists) can request a link.
                    // Anyone else gets a generic "link sent" response — same shape
                    // so we don't leak whether the email is registered.
                    shouldCreateUser: false,
                },
            });
            if (otpErr) {
                // Supabase returns a specific error for non-existent users when
                // shouldCreateUser=false. We swallow it to avoid email enumeration.
                if (/Signups not allowed/i.test(otpErr.message)) {
                    setSentTo(email);
                } else {
                    setError(otpErr.message);
                }
            } else {
                setSentTo(email);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send link');
        } finally {
            setPending(false);
        }
    }

    if (sentTo) {
        return (
            <div
                className="px-3 py-3 rounded-lg text-sm"
                style={{
                    backgroundColor: 'rgba(16,185,129,0.10)',
                    border: '1px solid rgba(16,185,129,0.35)',
                    color: '#86EFAC',
                }}
            >
                If <strong>{sentTo}</strong> is registered as a shipowner, a sign-in link is
                on its way. Check your inbox.
            </div>
        );
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            <OsInput
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@example.com"
                required
                autoFocus
                error={error ?? undefined}
            />
            <OsButton
                type="submit"
                variant="primary"
                loading={pending}
                disabled={pending || !email}
            >
                {pending ? 'Sending…' : 'Send sign-in link'}
            </OsButton>
        </form>
    );
}
