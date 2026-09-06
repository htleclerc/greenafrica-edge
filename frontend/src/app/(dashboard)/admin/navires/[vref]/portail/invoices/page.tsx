import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { ViewAsFrame } from '@/components/admin/ViewAsFrame';
import { OperatorInvoicesPage } from '@/components/owner/pages/OperatorInvoicesPage';
import { FinanceOnlyNotice } from '@/components/admin/FinanceOnlyNotice';

export const dynamic = 'force-dynamic';

/** Les factures de CE navire seulement : le client borné filtre `transactions` par vessel_id. */
export default async function PortailNavireInvoices({ params }: { params: Promise<{ vref: string }> }) {
    const { vref } = await params;
    const principal = await requireViewAsOwner({ vesselRef: vref, page: 'vessel-invoices' });
    return (
        <ViewAsFrame principal={principal}>
            {principal.viewAs?.canViewBilling ? <OperatorInvoicesPage principal={principal} /> : <FinanceOnlyNotice />}
        </ViewAsFrame>
    );
}
