import { requireOwner } from '@/lib/auth/requireOwner';
import { OperatorDisputesPage } from '@/components/owner/pages/OperatorDisputesPage';

export const metadata = { title: 'Owner portal — disputes' };
export const dynamic = 'force-dynamic';

export default async function OwnerDisputesRoute() {
    const session = await requireOwner();
    const principal = {
        kind: 'operator' as const,
        userId: session.userId,
        email: session.email,
        shipowner: session.shipowner,
        jurisdictionId: session.jurisdictionId,
        supabase: session.supabase,
    };
    return <OperatorDisputesPage principal={principal} />;
}
