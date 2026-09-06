import type { OperatorPrincipal } from '@/lib/auth/viewAsOwner';
import { ViewAsBanner } from './ViewAsBanner';

/**
 * Cadre d'une page « voir comme » : le bandeau, puis l'écran du portail.
 *
 * Posé par chaque page plutôt que par un layout : la personne regardée peut
 * venir de l'URL (`?as=mbr_…`), et un layout Next ne lit pas les paramètres
 * de requête.
 */
export function ViewAsFrame({ principal, children }: { principal: OperatorPrincipal; children: React.ReactNode }) {
    if (!principal.viewAs) return <>{children}</>;
    return (
        <div className="flex flex-col">
            <ViewAsBanner viewAs={principal.viewAs} />
            {children}
        </div>
    );
}
