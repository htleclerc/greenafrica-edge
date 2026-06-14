import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorDashboardPage } from '@/components/owner/pages/OperatorDashboardPage';
import { StaffDashboardPage } from '@/components/dashboard/overview/StaffDashboardPage';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    const principal = await requirePrincipal();
    if (principal.kind === 'operator') {
        return <OperatorDashboardPage principal={principal} />;
    }
    return <StaffDashboardPage />;
}
