import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { ViewAsFrame } from '@/components/admin/ViewAsFrame';
import { OperatorVesselDetailPage } from '@/components/owner/pages/OperatorVesselDetailPage';

export const dynamic = 'force-dynamic';
type SP = Promise<{ as?: string }>;

export default async function PortailVessel({ params, searchParams }: { params: Promise<{ ref: string; vref: string }>; searchParams: SP }) {
    const { ref, vref } = await params;
    const { as: memberRef } = await searchParams;
    const principal = await requireViewAsOwner({ ownerRef: ref, memberRef, page: `vessel:${vref}` });
    return <ViewAsFrame principal={principal}><OperatorVesselDetailPage principal={principal} vesselRef={vref} /></ViewAsFrame>;
}
