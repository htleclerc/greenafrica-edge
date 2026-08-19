import type { Metadata } from 'next';
import { InvoicesPage } from '@/components/dashboard/invoices/InvoicesPage';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import {
    OperatorInvoicesPage,
    PAYPAL_RETURNS,
    type PaypalReturn,
} from '@/components/owner/pages/OperatorInvoicesPage';

export const metadata: Metadata = {
    title: 'Invoices & Payments | Green Gate',
    description: 'Manage maritime carbon tax invoices, payments, and pro-forma generation.',
};

export default async function InvoicesRoute({
    searchParams,
}: {
    searchParams: Promise<{ stripe?: string; paypal?: string }>;
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
        // PayPal a quatre issues : la capture peut rester en attente (filet
        // webhook/cron) ou échouer sans qu'aucun montant ne soit prélevé.
        const paypalReturn = PAYPAL_RETURNS.includes(params.paypal as PaypalReturn)
            ? (params.paypal as PaypalReturn)
            : null;
        return (
            <OperatorInvoicesPage
                principal={principal}
                stripeReturn={stripeReturn}
                paypalReturn={paypalReturn}
            />
        );
    }
    return <InvoicesPage />;
}
