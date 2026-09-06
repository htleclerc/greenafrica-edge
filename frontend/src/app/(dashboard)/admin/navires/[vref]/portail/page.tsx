import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { OperatorVesselDetailPage } from '@/components/owner/pages/OperatorVesselDetailPage';

export const dynamic = 'force-dynamic';

export default async function PortailNavire({ params }: { params: Promise<{ vref: string }> }) {
    const { vref } = await params;
    const principal = await requireViewAsOwner({ vesselRef: vref, page: 'vessel' });
    return <OperatorVesselDetailPage principal={principal} vesselRef={vref} backHref="/admin/navires" />;
}
