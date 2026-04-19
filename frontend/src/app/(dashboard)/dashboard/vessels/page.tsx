import type { Metadata } from 'next';
import { VesselsPage } from '@/components/dashboard/vessels/VesselsPage';

export const metadata: Metadata = {
    title: 'Vessels & Compliance | Green Gate',
    description: 'Real-time vessel compliance monitoring for the Gulf of Aden EEZ.',
};

export default function VesselsRoute() {
    return <VesselsPage />;
}
