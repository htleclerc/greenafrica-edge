import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { RegisterModeSwitcher } from '@/components/auth/operator-register/RegisterModeSwitcher';

export const metadata: Metadata = {
    title: 'Inscription opérateur | Green Gate',
    description: 'Inscription self-service pour les opérateurs maritimes et aériens.',
};

// Un IMO valide fait 7 chiffres (voir normalizeVesselIdentifier). Un
// paramètre `imo` qui ne respecte pas ce format est ignoré silencieusement
// plutôt que transmis tel quel au formulaire — pas de pré-remplissage sur une
// valeur qui échouerait de toute façon le pattern du champ.
const IMO_PATTERN = /^\d{7}$/;

export default async function SignupPage({
    searchParams,
}: {
    searchParams: Promise<{ imo?: string }>;
}) {
    const flags = await readPortalFeatureFlags();
    const open = flags.selfServiceEnabled || flags.airSelfServiceEnabled;
    const t = await getTranslations('OwnerRegister');
    const { imo } = await searchParams;
    const prefillImo = imo && IMO_PATTERN.test(imo) ? imo : undefined;
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
                            prefillImo={prefillImo}
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
