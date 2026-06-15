import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorTcoPage } from '@/components/owner/pages/OperatorTcoPage';
import TcoDashboard from '@/components/dashboard/tco/TcoDashboard';

export const metadata: Metadata = {
    title: 'Total Cost of Ownership (TCO) | Green Gate',
    description: 'Transparent cost breakdown — carbon tax, emissions, and compliance costs for vessels and fleet management.',
};

export const dynamic = 'force-dynamic';

export default async function Page() {
    const principal = await requirePrincipal();
    // Operators have role='SHIPOWNER' in profiles (not 'SHIPPING_AGENT'), so
    // TcoDashboard's useRole() check would show them FinanceAdminView — wrong.
    // We bypass that by rendering ShippingAgentView directly via OperatorTcoPage.
    if (principal.kind === 'operator') {
        return <OperatorTcoPage />;
    }
    return <TcoDashboard />;
}
