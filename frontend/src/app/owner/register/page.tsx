import { getTranslations } from 'next-intl/server';
import { RegisterForm } from './RegisterForm';

export default async function OwnerRegisterPage() {
    const t = await getTranslations('OwnerRegister');
    return (
        <div className="min-h-screen os-bg flex items-center justify-center p-6">
            <div className="os-card max-w-2xl w-full p-8">
                <h1 className="text-2xl font-semibold mb-2">{t('title')}</h1>
                <p className="text-sm opacity-80 mb-6">{t('subtitle')}</p>
                <RegisterForm
                    recaptchaSiteKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ''}
                />
            </div>
        </div>
    );
}
