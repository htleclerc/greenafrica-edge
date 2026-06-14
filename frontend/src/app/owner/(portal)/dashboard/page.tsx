import { requireOwner } from '@/lib/auth/requireOwner';
import { OperatorDashboardPage } from '@/components/owner/pages/OperatorDashboardPage';

export const metadata = {
    title: 'Owner portal — dashboard',
};

export const dynamic = 'force-dynamic';

export default async function OwnerDashboardPage() {
    const session = await requireOwner();
    return <OperatorDashboardPage principal={{ kind: 'operator', ...session }} />;
}
