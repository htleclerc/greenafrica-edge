import type { Metadata } from 'next';
import { InvoicesPage } from '@/components/dashboard/invoices/InvoicesPage';

export const metadata: Metadata = {
    title: 'Invoices & Payments | Green Gate',
    description: 'Manage maritime carbon tax invoices, payments, and pro-forma generation.',
};

export default function InvoicesRoute() {
    return <InvoicesPage />;
}
