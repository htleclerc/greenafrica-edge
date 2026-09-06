import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { ViewAsFrame } from '@/components/admin/ViewAsFrame';
import { OperatorInvoicesPage } from '@/components/owner/pages/OperatorInvoicesPage';
import { FinanceOnlyNotice } from '@/components/admin/FinanceOnlyNotice';

export const dynamic = 'force-dynamic';
type SP = Promise<{ as?: string }>;

export default async function PortailInvoices({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: SP }) {
    const { ref } = await params;
    const { as: memberRef } = await searchParams;
    const principal = await requireViewAsOwner({ ownerRef: ref, memberRef, page: 'invoices' });
    return (
        <ViewAsFrame principal={principal}>
            {principal.viewAs?.canViewBilling ? <OperatorInvoicesPage principal={principal} /> : <FinanceOnlyNotice />}
        </ViewAsFrame>
    );
}
