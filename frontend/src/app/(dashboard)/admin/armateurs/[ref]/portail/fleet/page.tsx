import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { ViewAsFrame } from '@/components/admin/ViewAsFrame';
import { OperatorVesselsPage } from '@/components/owner/pages/OperatorVesselsPage';

export const dynamic = 'force-dynamic';
type SP = Promise<{ as?: string }>;

export default async function PortailFleet({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: SP }) {
    const { ref } = await params;
    const { as: memberRef } = await searchParams;
    const principal = await requireViewAsOwner({ ownerRef: ref, memberRef, page: 'fleet' });
    return <ViewAsFrame principal={principal}><OperatorVesselsPage principal={principal} /></ViewAsFrame>;
}
