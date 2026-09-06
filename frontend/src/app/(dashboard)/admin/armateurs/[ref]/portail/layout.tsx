import { requireViewAsOwner } from '@/lib/auth/viewAsOwner';
import { ViewAsBanner } from '@/components/admin/ViewAsBanner';

export const dynamic = 'force-dynamic';

/**
 * « Ce que voit l'armateur » — les vrais écrans du portail, en lecture seule.
 * Le bandeau est posé ici ; chaque page trace son ouverture (audit).
 */
export default async function PortailLayout({
    params, children,
}: { params: Promise<{ ref: string }>; children: React.ReactNode }) {
    const { ref } = await params;
    const principal = await requireViewAsOwner({ ownerRef: ref, page: 'layout', audit: false });
    return (
        <div className="flex flex-col">
            <ViewAsBanner viewAs={principal.viewAs!} />
            {children}
        </div>
    );
}
