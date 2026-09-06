import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { OperatorVesselDetailPage } from '@/components/owner/pages/OperatorVesselDetailPage';

export const dynamic = 'force-dynamic';

export default async function PortailVessel({ params }: { params: Promise<{ ref: string; vref: string }> }) {
    const { ref, vref } = await params;
    const principal = await requireViewAsOwner({ ownerRef: ref, page: `vessel:${vref}` });
    return <OperatorVesselDetailPage principal={principal} vesselRef={vref} />;
}
