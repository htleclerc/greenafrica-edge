import type { Metadata } from 'next';
import { DisputesPage } from '@/components/dashboard/disputes/DisputesPage';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorDisputesPage } from '@/components/owner/pages/OperatorDisputesPage';

export const metadata: Metadata = {
    title: 'Disputes & Contestations | Green Gate',
    description: 'View and manage carbon tax dispute cases, review evidence, and resolve contestations.',
};

export default async function DisputesRoute() {
    const principal = await requirePrincipal();
    if (principal.kind === 'operator') {
        return <OperatorDisputesPage principal={principal} />;
    }
    return <DisputesPage />;
}
