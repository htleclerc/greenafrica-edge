import { requireOwner } from '@/lib/auth/requireOwner';
import { OperatorVesselsPage } from '@/components/owner/pages/OperatorVesselsPage';

export const metadata = { title: 'Owner portal — fleet' };
export const dynamic = 'force-dynamic';

export default async function OwnerFleetPage() {
    const session = await requireOwner();
    const principal = {
        kind: 'operator' as const,
        userId: session.userId,
        email: session.email,
        shipowner: session.shipowner,
        jurisdictionId: session.jurisdictionId,
        supabase: session.supabase,
    };
    return <OperatorVesselsPage principal={principal} />;
}
