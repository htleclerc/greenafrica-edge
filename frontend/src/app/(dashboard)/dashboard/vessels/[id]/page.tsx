import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorVesselDetailPage } from '@/components/owner/pages/OperatorVesselDetailPage';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DashboardVesselDetailRoute({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const principal = await requirePrincipal();
    const { id } = await params;

    if (principal.kind === 'operator') {
        return (
            <OperatorVesselDetailPage
                principal={principal}
                vesselId={id}
                backHref="/dashboard/vessels"
            />
        );
    }

    // Staff currently have no dedicated vessel detail page in the dashboard shell.
    // Return 404 to avoid a blank render; a staff detail page can be added later.
    notFound();
}
