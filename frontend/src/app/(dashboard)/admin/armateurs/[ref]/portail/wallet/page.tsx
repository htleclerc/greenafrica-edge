import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { ViewAsFrame } from '@/components/admin/ViewAsFrame';
import { OperatorWalletPage } from '@/components/owner/pages/OperatorWalletPage';
import { FinanceOnlyNotice } from '@/components/admin/FinanceOnlyNotice';

export const dynamic = 'force-dynamic';
type SP = Promise<{ as?: string }>;

export default async function PortailWallet({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: SP }) {
    const { ref } = await params;
    const { as: memberRef } = await searchParams;
    const principal = await requireViewAsOwner({ ownerRef: ref, memberRef, page: 'wallet' });
    return (
        <ViewAsFrame principal={principal}>
            {principal.viewAs?.canViewBilling ? <OperatorWalletPage principal={principal} /> : <FinanceOnlyNotice />}
        </ViewAsFrame>
    );
}
