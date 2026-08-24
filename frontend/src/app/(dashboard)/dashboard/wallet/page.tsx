import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorWalletPage } from '@/components/owner/pages/OperatorWalletPage';
import { PAYPAL_RETURNS, type PaypalReturn } from '@/components/owner/pages/OperatorInvoicesPage';

export const metadata = {
    title: 'Wallet',
};

export const dynamic = 'force-dynamic';

export default async function WalletRoute({
    searchParams,
}: {
    searchParams: Promise<{ stripe?: string; paypal?: string }>;
}) {
    const principal = await requirePrincipal();
    if (principal.kind !== 'operator') notFound();

    // Retour d'un checkout externe pour une recharge : meme grammaire que la
    // page factures (?stripe=success|cancel, ?paypal=success|cancel|pending|failed).
    const params = await searchParams;
    const stripeReturn =
        params.stripe === 'success' ? 'success' : params.stripe === 'cancel' ? 'cancel' : null;
    const paypalReturn = PAYPAL_RETURNS.includes(params.paypal as PaypalReturn)
        ? (params.paypal as PaypalReturn)
        : null;

    return (
        <OperatorWalletPage
            principal={principal}
            stripeReturn={stripeReturn}
            paypalReturn={paypalReturn}
        />
    );
}
