import { getTranslations } from 'next-intl/server';
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
    const t = await getTranslations('OwnerPortal');

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
                        Green Gate · {t('brand')}
                    </div>
                    <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">
                        {t('login.title')}
                    </h1>
                    <p className="text-sm text-[var(--os-text-muted)] mt-1">
                        {t('login.subtitle')}
                    </p>
                </div>

                {error && <ErrorBanner code={error} />}

                <OwnerLoginForm />

                <p className="text-xs text-[var(--os-text-muted)] mt-6">
                    {t('login.footerNote')}
                </p>
            </div>
        </div>
    );
}

async function ErrorBanner({ code }: { code: string }) {
    const t = await getTranslations('OwnerPortal.login.errors');
    const message =
        code === 'no_owner_record' ? t('noOwnerRecord')
            : code === 'state_invited' ? t('invited')
                : code === 'state_ghost' ? t('ghost')
                    : code === 'callback_failed' ? t('callbackFailed')
                        : t('generic');
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
