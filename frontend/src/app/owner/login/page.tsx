import { OwnerLoginForm } from './OwnerLoginForm';

export const metadata = {
    title: 'Owner portal — sign in',
};

interface SearchParams {
    error?: string;
}

export default async function OwnerLoginPage({
    searchParams,
}: {
    searchParams: Promise<SearchParams>;
}) {
    const { error } = await searchParams;

    return (
        <div className="min-h-screen flex items-center justify-center px-4 os-bg">
            <div
                className="w-full max-w-md p-8 rounded-2xl"
                style={{
                    backgroundColor: 'var(--os-surface-2)',
                    border: '1px solid var(--os-border)',
                }}
            >
                <div className="mb-6">
                    <div
                        className="text-[10px] font-semibold tracking-widest uppercase mb-1"
                        style={{ color: 'rgb(16,185,129,0.7)' }}
                    >
                        Green Gate · Shipowner portal
                    </div>
                    <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">
                        Sign in with your email
                    </h1>
                    <p className="text-sm text-[var(--os-text-muted)] mt-1">
                        We'll send a one-time link to your inbox. No password required.
                    </p>
                </div>

                {error && <ErrorBanner code={error} />}

                <OwnerLoginForm />

                <p className="text-xs text-[var(--os-text-muted)] mt-6">
                    Access is invitation-only. If you haven't received an invite, ask the
                    Port Operations team to enrol your account.
                </p>
            </div>
        </div>
    );
}

function ErrorBanner({ code }: { code: string }) {
    const message =
        code === 'no_owner_record'
            ? "We couldn't find a shipowner profile for that email."
            : code === 'state_invited'
              ? 'Your invitation is still pending — please open the magic link from your invitation email.'
              : code === 'state_ghost'
                ? 'Your account has not been invited to the portal yet.'
                : code === 'callback_failed'
                  ? 'The sign-in link has expired or was already used. Request a new one below.'
                  : 'Sign-in failed. Try again.';
    return (
        <div
            className="mb-4 px-3 py-2 rounded-lg text-xs"
            style={{
                backgroundColor: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.35)',
                color: '#FCA5A5',
            }}
            role="alert"
        >
            {message}
        </div>
    );
}
