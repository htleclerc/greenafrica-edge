import type { Metadata } from 'next';
import { DisputesPage } from '@/components/dashboard/disputes/DisputesPage';

export const metadata: Metadata = {
    title: 'Disputes & Contestations | Green Gate',
    description: 'View and manage carbon tax dispute cases, review evidence, and resolve contestations.',
};

export default function DisputesRoute() {
    return <DisputesPage />;
}
