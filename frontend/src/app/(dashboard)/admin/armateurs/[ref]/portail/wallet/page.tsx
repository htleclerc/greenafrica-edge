import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { OperatorWalletPage } from '@/components/owner/pages/OperatorWalletPage';
import { FinanceOnlyNotice } from '@/components/admin/FinanceOnlyNotice';

export const dynamic = 'force-dynamic';

export default async function PortailWallet({ params }: { params: Promise<{ ref: string }> }) {
    const { ref } = await params;
    const principal = await requireViewAsOwner({ ownerRef: ref, page: 'wallet' });
    if (!principal.viewAs?.canViewBilling) return <FinanceOnlyNotice />;
    return <OperatorWalletPage principal={principal} />;
}
