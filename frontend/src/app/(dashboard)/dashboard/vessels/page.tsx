import type { Metadata } from 'next';
import { VesselsPage } from '@/components/dashboard/vessels/VesselsPage';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorVesselsPage } from '@/components/owner/pages/OperatorVesselsPage';

export const metadata: Metadata = {
    title: 'Vessels & Compliance | Green Gate',
    description: 'Real-time vessel compliance monitoring for the Gulf of Aden EEZ.',
};

export default async function VesselsRoute() {
    const principal = await requirePrincipal();
    if (principal.kind === 'operator') {
        return <OperatorVesselsPage principal={principal} />;
    }
    return <VesselsPage />;
}
