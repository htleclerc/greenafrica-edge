'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

export function KycCBanner({ kycComplete }: { kycComplete: boolean }) {
    const t = useTranslations('OwnerOnboarding.banner');
    if (kycComplete) return null;
    return (
        <div className="bg-amber-600/20 border-l-4 border-amber-500 px-4 py-3 mb-4">
            <div className="flex items-center justify-between">
                <span>{t('text')}</span>
                <Link href="/owner/onboarding/billing" className="os-button-sm">
                    {t('cta')}
                </Link>
            </div>
        </div>
    );
}
