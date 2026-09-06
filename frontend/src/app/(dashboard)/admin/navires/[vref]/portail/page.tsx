import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { ViewAsFrame } from '@/components/admin/ViewAsFrame';
import { OperatorVesselDetailPage } from '@/components/owner/pages/OperatorVesselDetailPage';

export const dynamic = 'force-dynamic';

/**
 * Le portail vu depuis UN navire : fiche, factures et relevé de ce seul
 * navire — ce que voit un gestionnaire dont l'accès est limité à ce navire.
 */
export default async function PortailNavire({ params }: { params: Promise<{ vref: string }> }) {
    const { vref } = await params;
    const principal = await requireViewAsOwner({ vesselRef: vref, page: 'vessel' });
    return (
        <ViewAsFrame principal={principal}>
            <OperatorVesselDetailPage principal={principal} vesselRef={vref} backHref="/admin/navires" />
        </ViewAsFrame>
    );
}
