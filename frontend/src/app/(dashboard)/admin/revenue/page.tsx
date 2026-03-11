import type { Metadata } from 'next';
import { RevenueDashboard } from '@/components/dashboard/revenue/RevenueDashboard';

export const metadata: Metadata = {
    title: 'Revenue Dashboard | Africgreen',
    description: 'Maritime carbon tax revenue analytics and financial reporting.',
};

export default function RevenueRoute() {
    return <RevenueDashboard />;
}
