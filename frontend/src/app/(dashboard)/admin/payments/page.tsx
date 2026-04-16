import type { Metadata } from 'next';
import { PaymentProvidersPanel } from '@/components/dashboard/admin/PaymentProvidersPanel';

export const metadata: Metadata = {
    title: 'Payment Providers | Africgreen',
    description: 'Configure the active payment provider for tax collection.',
};

export default function PaymentsAdminRoute() {
    return <PaymentProvidersPanel />;
}
