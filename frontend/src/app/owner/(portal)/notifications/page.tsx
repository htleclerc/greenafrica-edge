import { requireOwner } from '@/lib/auth/requireOwner';
import { OperatorNotificationsPage } from '@/components/owner/pages/OperatorNotificationsPage';

export const metadata = {
    title: 'Owner portal — notifications',
};

export const dynamic = 'force-dynamic';

export default async function OwnerNotificationsPage() {
    const session = await requireOwner();
    return <OperatorNotificationsPage principal={{ kind: 'operator', ...session }} />;
}
