import { UserRole } from '@/types/secure';

export interface LoginPrincipal {
    /** True if the authenticated user owns a shipowners row (maritime OR air operator). */
    isOperator: boolean;
    /** profiles.role for staff; null/unknown is treated as ordinary staff. */
    role: UserRole | null;
}

/**
 * Pure routing decision after a successful sign-in. Operator status wins over
 * role (an operator never lands in the staff shell). SUPERADMIN goes through
 * the impersonation step; every other staff role goes straight to /dashboard.
 *
 * Phase 2: operators now land on /dashboard (same shell as staff, operator-aware
 * nav). The legacy /owner/dashboard redirects to /dashboard via middleware.
 */
export function loginDestination({ isOperator, role }: LoginPrincipal): string {
    if (isOperator) return '/dashboard';
    if (role === UserRole.SUPERADMIN) return '/post-login';
    return '/dashboard';
}
