import { redirect } from 'next/navigation';
import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { OperatorDashboardPage } from '@/components/owner/pages/OperatorDashboardPage';

export const dynamic = 'force-dynamic';

/** Accueil du portail tel que l'armateur le voit. Sans accès aux montants : la flotte. */
export default async function PortailHome({ params }: { params: Promise<{ ref: string }> }) {
    const { ref } = await params;
    const principal = await requireViewAsOwner({ ownerRef: ref, page: 'overview' });
    if (!principal.viewAs?.canViewBilling) redirect(`${principal.viewAs?.basePath}/fleet`);
    return <OperatorDashboardPage principal={principal} />;
}
