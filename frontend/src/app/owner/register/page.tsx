import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { RegisterModeSwitcher } from './RegisterModeSwitcher';

export default async function OwnerRegisterPage() {
    const flags = await readPortalFeatureFlags();
    // Self-service is available if EITHER mode is enabled. When both are off,
    // bounce back to login (same behaviour as before).
    if (!flags.selfServiceEnabled && !flags.airSelfServiceEnabled) {
        redirect('/login?signup_disabled=1');
    }
    const t = await getTranslations('OwnerRegister');
    return (
        <div className="min-h-screen os-bg flex items-center justify-center p-6">
            <div className="os-card max-w-2xl w-full p-8">
                <h1 className="text-2xl font-semibold mb-2">{t('title')}</h1>
                <p className="text-sm opacity-80 mb-6">{t('subtitle')}</p>
                <RegisterModeSwitcher
                    recaptchaSiteKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ''}
                    maritimeEnabled={flags.selfServiceEnabled}
                    airEnabled={flags.airSelfServiceEnabled}
                />
            </div>
        </div>
    );
}
