import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { OperatorInvoicesPage } from '@/components/owner/pages/OperatorInvoicesPage';
import { FinanceOnlyNotice } from '@/components/admin/FinanceOnlyNotice';

export const dynamic = 'force-dynamic';

export default async function PortailInvoices({ params }: { params: Promise<{ ref: string }> }) {
    const { ref } = await params;
    const principal = await requireViewAsOwner({ ownerRef: ref, page: 'invoices' });
    if (!principal.viewAs?.canViewBilling) return <FinanceOnlyNotice />;
    return <OperatorInvoicesPage principal={principal} />;
}
