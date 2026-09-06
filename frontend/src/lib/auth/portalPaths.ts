import type { OwnerViewAs } from '@/lib/auth/requirePrincipal';

/**
 * Où mènent les liens du portail armateur.
 *
 * Les mêmes composants servent l'armateur (sous `/dashboard`) et le staff qui
 * le regarde en lecture seule (sous `/admin/…/portail`). Un lien écrit en dur
 * vers `/dashboard/invoices` ferait sortir le staff de la vue ; c'est donc le
 * principal qui dit où l'on est.
 */
export interface PortalPaths {
    home: string;
    invoices: string;
    fleet: string;
    vessel: (ref: string) => string;
    wallet: string;
    /** Vrai dans la vue staff : les actions sont visibles mais désactivées. */
    readOnly: boolean;
    /** Vrai quand le rôle du staff n'a pas accès aux montants facturés. */
    hideAmounts: boolean;
}

export function portalPaths(principal: { viewAs?: OwnerViewAs }): PortalPaths {
    const view = principal.viewAs;
    if (!view) {
        return {
            home: '/dashboard',
            invoices: '/dashboard/invoices',
            fleet: '/dashboard/vessels',
            vessel: (ref) => `/dashboard/vessels/${ref}`,
            wallet: '/dashboard/wallet',
            readOnly: false,
            hideAmounts: false,
        };
    }
    const base = view.basePath;
    // Portée navire : la « flotte » et le « détail » sont le même écran, celui
    // du navire regardé — il n'y a rien d'autre à montrer.
    const vesselScoped = Boolean(view.vessel);
    return {
        home: base,
        invoices: `${base}/invoices`,
        fleet: vesselScoped ? base : `${base}/fleet`,
        vessel: (ref) => (vesselScoped ? base : `${base}/fleet/${ref}`),
        wallet: `${base}/wallet`,
        readOnly: true,
        hideAmounts: !view.canViewBilling,
    };
}
