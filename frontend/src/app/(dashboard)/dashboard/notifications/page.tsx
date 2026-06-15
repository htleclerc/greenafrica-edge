import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorNotificationsPage } from '@/components/owner/pages/OperatorNotificationsPage';

export const metadata = {
    title: 'Notifications',
};

export const dynamic = 'force-dynamic';

export default async function NotificationsRoute() {
    const principal = await requirePrincipal();
    if (principal.kind !== 'operator') notFound();
    return <OperatorNotificationsPage principal={principal} />;
}
