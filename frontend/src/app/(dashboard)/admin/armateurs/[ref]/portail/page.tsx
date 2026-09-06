import { redirect } from 'next/navigation';
import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { ViewAsFrame } from '@/components/admin/ViewAsFrame';
import { OperatorDashboardPage } from '@/components/owner/pages/OperatorDashboardPage';

export const dynamic = 'force-dynamic';
type SP = Promise<{ as?: string }>;

/** Accueil du portail tel que la personne le voit. Sans accès aux montants : la flotte. */
export default async function PortailHome({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: SP }) {
    const { ref } = await params;
    const { as: memberRef } = await searchParams;
    const principal = await requireViewAsOwner({ ownerRef: ref, memberRef, page: 'overview' });
    if (!principal.viewAs?.canViewBilling) redirect(`${principal.viewAs?.basePath}/fleet${principal.viewAs?.query ?? ''}`);
    return <ViewAsFrame principal={principal}><OperatorDashboardPage principal={principal} /></ViewAsFrame>;
}
