import type { Metadata } from 'next';
import { InvoicesPage } from '@/components/dashboard/invoices/InvoicesPage';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorInvoicesPage } from '@/components/owner/pages/OperatorInvoicesPage';

export const metadata: Metadata = {
    title: 'Invoices & Payments | Green Gate',
    description: 'Manage maritime carbon tax invoices, payments, and pro-forma generation.',
};

export default async function InvoicesRoute({
    searchParams,
}: {
    searchParams: Promise<{ stripe?: string }>;
}) {
    const principal = await requirePrincipal();
    if (principal.kind === 'operator') {
        const params = await searchParams;
        const stripeReturn =
            params.stripe === 'success'
                ? 'success'
                : params.stripe === 'cancel'
                  ? 'cancel'
                  : null;
        return <OperatorInvoicesPage principal={principal} stripeReturn={stripeReturn} />;
    }
    return <InvoicesPage />;
}
