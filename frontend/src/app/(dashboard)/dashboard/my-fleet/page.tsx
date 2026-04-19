import type { Metadata } from 'next';
import { MyFleetPage } from '@/components/dashboard/fleet/MyFleetPage';

export const metadata: Metadata = {
    title: 'My Fleet | Green Gate',
    description: 'Self-service portal for shipping agents to manage fleet compliance and invoices.',
};

export default function MyFleetRoute() {
    return <MyFleetPage />;
}
