import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyFleetPage } from '@/components/dashboard/fleet/MyFleetPage';
import { OwnerFleetPanel } from '@/components/dashboard/fleet/OwnerFleetPanel';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { listOwnerFleet } from '@/services/ownerFleetService';

export const metadata: Metadata = {
    title: 'My Fleet | Green Gate',
    description: 'Self-service portal for shipping agents to manage fleet compliance and invoices.',
};

/**
 * Deux écrans sous une même route.
 *
 * Un armateur voit SA flotte, sur données réelles, avec les gestes de
 * correction. Le personnel garde la vue existante — elle sert au suivi et
 * n'a pas à offrir des gestes réservés au propriétaire du dossier.
 *
 * Le contrôle d'accès est fait ici, côté serveur : la liste des navires est
 * bornée à l'armateur de la session avant d'atteindre le client.
 */
export default async function MyFleetRoute() {
    const principal = await requirePrincipal();

    if (principal.kind !== 'operator') return <MyFleetPage />;

    const shipownerId = principal.shipowner?.id;
    if (!shipownerId) redirect('/login?error=no_owner_record');

    const fleet = await listOwnerFleet(principal.supabase, shipownerId);
    return (
        <OwnerFleetPanel
            fleet={fleet}
            privileges={principal.privileges}
            isMember={principal.isMember}
        />
    );
}
