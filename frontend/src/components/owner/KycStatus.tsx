'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { OsBadge } from '@/components/ui/OsBadge';

interface Props { bDone: boolean; cDone: boolean; bPendingReverif?: boolean }

export function KycStatus({ bDone, cDone, bPendingReverif = false }: Props) {
    const t = useTranslations('OwnerProfile.status');
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
                <OsBadge variant={bDone ? 'active' : 'warning'} label={`KYC-B: ${bDone ? t('done') : t('pending')}`} />
                <OsBadge variant={cDone ? 'active' : 'warning'} label={`KYC-C: ${cDone ? t('done') : t('pending')}`} />
            </div>
            {bPendingReverif && <p className="text-sm text-[#F59E0B]">{t('reverifNotice')}</p>}
            {!cDone && (
                <Link href="/owner/onboarding/billing" className="text-sm text-emerald-400 hover:underline">
                    {t('completeBilling')}
                </Link>
            )}
        </div>
    );
}
