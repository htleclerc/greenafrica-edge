import { requireOwner } from '@/lib/auth/requireOwner';
import { OperatorAlertsPage } from '@/components/owner/pages/OperatorAlertsPage';

export const metadata = {
    title: 'Owner portal — alerts',
};

export const dynamic = 'force-dynamic';

export default async function OwnerAlertsRoute() {
    const session = await requireOwner();
    const principal = {
        kind: 'operator' as const,
        userId: session.userId,
        email: session.email,
        shipowner: session.shipowner,
        jurisdictionId: session.jurisdictionId,
        supabase: session.supabase,
    };
    return <OperatorAlertsPage principal={principal} />;
}
