import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { RegisterModeSwitcher } from '@/components/auth/operator-register/RegisterModeSwitcher';

export const metadata: Metadata = {
    title: 'Inscription opérateur | Green Gate',
    description: 'Inscription self-service pour les opérateurs maritimes et aériens.',
};

export default async function SignupPage() {
    const flags = await readPortalFeatureFlags();
    const open = flags.selfServiceEnabled || flags.airSelfServiceEnabled;
    const t = await getTranslations('OwnerRegister');
    return (
        <div className="min-h-screen os-bg flex items-center justify-center p-6">
            <div className="os-card max-w-2xl w-full p-8">
                {open ? (
                    <>
                        <h1 className="text-2xl font-semibold mb-2">{t('title')}</h1>
                        <p className="text-sm opacity-80 mb-6">{t('subtitle')}</p>
                        <RegisterModeSwitcher
                            recaptchaSiteKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ''}
                            maritimeEnabled={flags.selfServiceEnabled}
                            airEnabled={flags.airSelfServiceEnabled}
                        />
                    </>
                ) : (
                    <div className="text-center">
                        <h1 className="text-2xl font-semibold mb-2">{t('closed_title')}</h1>
                        <p className="text-sm opacity-80 mb-6">{t('closed_body')}</p>
                        <a href="/login" className="os-button inline-block">{t('back_to_login')}</a>
                    </div>
                )}
            </div>
        </div>
    );
}
