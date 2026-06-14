import { requireOwner } from '@/lib/auth/requireOwner';
import { OperatorVesselDetailPage } from '@/components/owner/pages/OperatorVesselDetailPage';

export const metadata = {
    title: 'Owner portal — vessel detail',
};

export const dynamic = 'force-dynamic';

export default async function OwnerVesselDetailRoute({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await requireOwner();
    const { id } = await params;
    const principal = {
        kind: 'operator' as const,
        userId: session.userId,
        email: session.email,
        shipowner: session.shipowner,
        jurisdictionId: session.jurisdictionId,
        supabase: session.supabase,
    };
    return (
        <OperatorVesselDetailPage
            principal={principal}
            vesselId={id}
            backHref="/owner/vessels"
        />
    );
}
