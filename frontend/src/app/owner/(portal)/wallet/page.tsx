import { requireOwner } from '@/lib/auth/requireOwner';
import { OperatorWalletPage } from '@/components/owner/pages/OperatorWalletPage';

export const metadata = {
    title: 'Owner portal — wallet',
};

export const dynamic = 'force-dynamic';

export default async function OwnerWalletPage() {
    const session = await requireOwner();
    return <OperatorWalletPage principal={{ kind: 'operator', ...session }} />;
}
