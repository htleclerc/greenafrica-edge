import { UserRole } from '@/types/secure';

export interface LoginPrincipal {
    /** True if the authenticated user owns a shipowners row (maritime OR air operator). */
    isOperator: boolean;
    /** profiles.role for staff; null/unknown is treated as ordinary staff. */
    role: UserRole | null;
    /**
     * profiles.collections_focus (mig 142) — le profil travaille au
     * recouvrement. Confort de navigation, pas un droit : il ne fait que
     * choisir l'atterrissage et resserrer le menu.
     */
    collectionsFocus?: boolean;
    /** `profiles.payments_only` (mig 154) : la personne n'a qu'un écran. */
    paymentsOnly?: boolean;
}

/**
 * Pure routing decision after a successful sign-in. Operator status wins over
 * role (an operator never lands in the staff shell). SUPERADMIN goes through
 * the impersonation step; every other staff role goes straight to /dashboard.
 *
 * Phase 2: operators now land on /dashboard (same shell as staff, operator-aware
 * nav). The legacy /owner/dashboard redirects to /dashboard via middleware.
 */
export function loginDestination({ isOperator, role, collectionsFocus, paymentsOnly }: LoginPrincipal): string {
    if (isOperator) return '/dashboard';
    // Encaissements seulement : un seul écran, avant tout autre aiguillage —
    // le middleware y renverrait de toute façon.
    if (paymentsOnly) return '/admin/payments';
    if (role === UserRole.SUPERADMIN) return '/post-login';
    if (role === UserRole.MANAGER) return '/dashboard/vision';
    // Après l'impersonation du SUPERADMIN et avant le repli générique : un profil
    // de recouvrement ouvre sa session sur son tableau de bord, pas sur la carte.
    if (collectionsFocus) return '/admin/reglements';
    return '/dashboard';
}
