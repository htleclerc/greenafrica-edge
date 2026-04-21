'use client';

// ─────────────────────────────────────────────────────────────────────────────
// /auth/setup-password
// ─────────────────────────────────────────────────────────────────────────────
//
// Landing page for users who just clicked their invitation magic link.
// /auth/sl already established their session; here they overwrite the
// throwaway password set during invitation creation with one they own.
//
// On success → redirect to /dashboard.
// ─────────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { useRouter } from 'next/navigation';

export default function SetupPasswordPage() {
    const router = useRouter();
    const [password, setPassword] = React.useState('');
    const [confirm, setConfirm] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }
        if (password !== confirm) {
            setError('Passwords do not match');
            return;
        }

        setSubmitting(true);
        try {
            const resp = await fetch('/api/auth/set-initial-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                setError(data.error || `Request failed (${resp.status})`);
                setSubmitting(false);
                return;
            }
            // Success — go to dashboard. Use replace so back button doesn't
            // bring them to the password form.
            router.replace('/dashboard');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Network error');
            setSubmitting(false);
        }
    }

    return (
        <div
            style={{
                minHeight: '100vh',
                backgroundColor: 'var(--os-bg, #0A1110)',
                color: 'var(--os-text-primary, #E5E7EB)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: 420,
                    padding: 32,
                    borderRadius: 12,
                    backgroundColor: 'var(--os-surface, #111C18)',
                    border: '1px solid var(--os-border, #1F2937)',
                }}
            >
                <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
                    Welcome to Green Gate
                </h1>
                <p style={{ fontSize: 13, color: 'var(--os-text-muted, #94A3B8)', marginBottom: 24 }}>
                    Choose a password to finish activating your shipping agent account. You'll
                    use it together with your email to log in next time.
                </p>

                <form onSubmit={handleSubmit}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, color: 'var(--os-text-muted, #94A3B8)' }}>
                        New password
                    </label>
                    <input
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
                        maxLength={128}
                        autoFocus
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: 8,
                            backgroundColor: 'var(--os-bg, #0A1110)',
                            border: '1px solid var(--os-border, #1F2937)',
                            color: 'inherit',
                            fontSize: 14,
                            marginBottom: 16,
                        }}
                    />

                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, color: 'var(--os-text-muted, #94A3B8)' }}>
                        Confirm password
                    </label>
                    <input
                        type="password"
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                        minLength={8}
                        maxLength={128}
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: 8,
                            backgroundColor: 'var(--os-bg, #0A1110)',
                            border: '1px solid var(--os-border, #1F2937)',
                            color: 'inherit',
                            fontSize: 14,
                            marginBottom: 16,
                        }}
                    />

                    {error && (
                        <div
                            style={{
                                padding: '10px 12px',
                                marginBottom: 16,
                                borderRadius: 8,
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                color: '#FCA5A5',
                                fontSize: 13,
                            }}
                        >
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        style={{
                            width: '100%',
                            padding: '12px 16px',
                            borderRadius: 8,
                            backgroundColor: '#10B981',
                            color: '#FFFFFF',
                            fontSize: 14,
                            fontWeight: 600,
                            border: 'none',
                            cursor: submitting ? 'not-allowed' : 'pointer',
                            opacity: submitting ? 0.6 : 1,
                            transition: 'opacity 120ms',
                        }}
                    >
                        {submitting ? 'Activating…' : 'Activate account →'}
                    </button>

                    <p style={{ marginTop: 16, fontSize: 11, color: 'var(--os-text-muted, #94A3B8)', textAlign: 'center' }}>
                        Minimum 8 characters. Use a long passphrase you'll remember.
                    </p>
                </form>
            </div>
        </div>
    );
}
