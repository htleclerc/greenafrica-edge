import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { OperatorVesselsPage } from '@/components/owner/pages/OperatorVesselsPage';

export const dynamic = 'force-dynamic';

export default async function PortailFleet({ params }: { params: Promise<{ ref: string }> }) {
    const { ref } = await params;
    const principal = await requireViewAsOwner({ ownerRef: ref, page: 'fleet' });
    return <OperatorVesselsPage principal={principal} />;
}
