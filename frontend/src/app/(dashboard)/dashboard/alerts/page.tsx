import type { Metadata } from 'next';
import { AlertsPage } from '@/components/dashboard/alerts/AlertsPage';

export const metadata: Metadata = {
    title: 'Alerts & Exceptions | Green Gate',
    description: 'Real-time compliance violations, payment exceptions, and system event monitoring.',
};

export default function AlertsRoute() {
    return <AlertsPage />;
}
