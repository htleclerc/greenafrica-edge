import { requireOwner } from '@/lib/auth/requireOwner';
import { OperatorInvoicesPage } from '@/components/owner/pages/OperatorInvoicesPage';

export const metadata = {
    title: 'Owner portal — invoices',
};

export const dynamic = 'force-dynamic';

export default async function OwnerInvoicesRoute({
    searchParams,
}: {
    searchParams: Promise<{ stripe?: string }>;
}) {
    const session = await requireOwner();
    const params = await searchParams;
    const stripeReturn =
        params.stripe === 'success'
            ? 'success'
            : params.stripe === 'cancel'
              ? 'cancel'
              : null;

    const principal = {
        kind: 'operator' as const,
        userId: session.userId,
        email: session.email,
        shipowner: session.shipowner,
        jurisdictionId: session.jurisdictionId,
        supabase: session.supabase,
    };

    return <OperatorInvoicesPage principal={principal} stripeReturn={stripeReturn} />;
}
