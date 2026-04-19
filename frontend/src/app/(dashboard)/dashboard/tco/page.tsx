import type { Metadata } from 'next';
import TcoDashboard from '@/components/dashboard/tco/TcoDashboard';

export const metadata: Metadata = {
    title: 'Total Cost of Ownership (TCO) | Green Gate',
    description: 'Transparent cost breakdown — carbon tax, emissions, and compliance costs for vessels and fleet management.',
};

export default function Page() {
    return <TcoDashboard />;
}
