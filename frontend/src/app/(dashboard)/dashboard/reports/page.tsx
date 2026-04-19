import type { Metadata } from 'next';
import { GovReportsPage } from '@/components/dashboard/reports/GovReportsPage';

export const metadata: Metadata = {
    title: 'Analytics & Reports | Green Gate',
    description: 'Government reporting portal — revenue analytics, compliance reports, and environmental data for Somaliland maritime authority.',
};

export default function ReportsRoute() {
    return <GovReportsPage />;
}
