import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorWalletPage } from '@/components/owner/pages/OperatorWalletPage';

export const metadata = {
    title: 'Wallet',
};

export const dynamic = 'force-dynamic';

export default async function WalletRoute() {
    const principal = await requirePrincipal();
    if (principal.kind !== 'operator') notFound();
    return <OperatorWalletPage principal={principal} />;
}
