import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { ViewAsBanner } from '@/components/admin/ViewAsBanner';

export const dynamic = 'force-dynamic';

/**
 * Le portail vu depuis UN navire : factures, relevé et fiche de ce seul
 * navire — ce que voit un gestionnaire dont l'accès est limité à ce navire.
 */
export default async function PortailNavireLayout({
    params, children,
}: { params: Promise<{ vref: string }>; children: React.ReactNode }) {
    const { vref } = await params;
    const principal = await requireViewAsOwner({ vesselRef: vref, page: 'layout', audit: false });
    return (
        <div className="flex flex-col">
            <ViewAsBanner viewAs={principal.viewAs!} />
            {children}
        </div>
    );
}
