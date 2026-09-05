import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { OperatorVesselDetailPage } from '@/components/owner/pages/OperatorVesselDetailPage';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DashboardVesselDetailRoute({
    params,
}: {
    params: Promise<{ ref: string }>;
}) {
    const principal = await requirePrincipal();
    // Référence opaque (mig 147), jamais l'identifiant interne.
    const { ref } = await params;

    if (principal.kind === 'operator') {
        return (
            <OperatorVesselDetailPage
                principal={principal}
                vesselRef={ref}
                backHref="/dashboard/vessels"
            />
        );
    }

    // Staff currently have no dedicated vessel detail page in the dashboard shell.
    // Return 404 to avoid a blank render; a staff detail page can be added later.
    notFound();
}
