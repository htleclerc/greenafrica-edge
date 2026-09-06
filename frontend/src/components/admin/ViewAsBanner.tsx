import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Eye } from 'lucide-react';
import type { OwnerViewAs } from '@/lib/auth/requirePrincipal';
import { OsBadge } from '@/components/ui/OsBadge';
import { ViewAsTabs, type ViewAsTab } from './ViewAsTabs';

/**
 * Bandeau de la vue « voir comme l'armateur ».
 *
 * Permanent, au-dessus de chaque page de la vue : il dit QUI l'on regarde,
 * que rien ne peut être déclenché d'ici, et d'où revenir. Les volets
 * réservés à la finance restent visibles mais désactivés pour un rôle qui
 * n'a pas accès aux montants : l'agent sait que l'écran existe.
 */
export async function ViewAsBanner({ viewAs }: { viewAs: OwnerViewAs }) {
    const t = await getTranslations('AdminOwnerView');
    const base = viewAs.basePath;
    const q = viewAs.query ?? '';
    const finance = viewAs.canViewBilling;
    const financeHint = finance ? undefined : t('financeOnly');

    const tabs: ViewAsTab[] = viewAs.vessel
        ? [
            { href: base, label: t('tabVessel'), exact: true, query: q },
            { href: `${base}/invoices`, label: t('tabInvoices'), disabled: !finance, title: financeHint, query: q },
        ]
        : [
            { href: base, label: t('tabOverview'), exact: true, disabled: !finance, title: financeHint, query: q },
            { href: `${base}/invoices`, label: t('tabInvoices'), disabled: !finance, title: financeHint, query: q },
            { href: `${base}/fleet`, label: t('tabFleet'), query: q },
            { href: `${base}/wallet`, label: t('tabWallet'), disabled: !finance, title: financeHint, query: q },
        ];

    const backHref = viewAs.vessel ? '/admin/navires' : `/admin/armateurs/${viewAs.ownerRef}`;

    return (
        <div className="sticky top-0 z-20 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 sm:px-6">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
                <Eye className="size-4 text-amber-400" aria-hidden />
                <p className="text-sm text-[var(--os-text-primary)]">
                    {viewAs.vessel
                        ? t('viewingVessel', { vessel: viewAs.vessel.name, name: viewAs.ownerName })
                        : viewAs.member
                            ? t('viewingMember', { member: viewAs.member.name ?? viewAs.member.email ?? viewAs.member.ref, name: viewAs.ownerName })
                            : t('viewing', { name: viewAs.ownerName })}
                </p>
                <OsBadge variant="warning" label={t('readOnly')} size="sm" />
                <span className="font-mono text-[11px] text-[var(--os-text-muted)]">{viewAs.ownerRef}</span>
                <Link href={backHref} className="ml-auto text-xs text-[#00D97E] hover:underline">
                    {viewAs.vessel ? t('backToVessels') : t('backToFile')}
                </Link>
                <div className="basis-full">
                    <ViewAsTabs tabs={tabs} />
                </div>
            </div>
        </div>
    );
}
