import type { Metadata } from 'next';
import { AlertsPage } from '@/components/dashboard/alerts/AlertsPage';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorAlertsPage } from '@/components/owner/pages/OperatorAlertsPage';

export const metadata: Metadata = {
    title: 'Alerts & Exceptions | Green Gate',
    description: 'Real-time compliance violations, payment exceptions, and system event monitoring.',
};

export default async function AlertsRoute() {
    const principal = await requirePrincipal();
    if (principal.kind === 'operator') {
        return <OperatorAlertsPage principal={principal} />;
    }
    return <AlertsPage />;
}
