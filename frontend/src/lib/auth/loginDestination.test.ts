import { describe, it, expect } from 'vitest';
import { loginDestination } from './loginDestination';
import { UserRole } from '@/types/secure';

describe('loginDestination', () => {
    it('routes an operator (has shipowners row) to the unified dashboard', () => {
        // Operators now land on /dashboard (Phase 2 — shell merge).
        // Legacy /owner/dashboard redirects → /dashboard via middleware.
        expect(loginDestination({ isOperator: true, role: UserRole.PORT_OFFICER })).toBe('/dashboard');
        expect(loginDestination({ isOperator: true, role: null })).toBe('/dashboard');
    });

    it('routes a SUPERADMIN to the impersonation step', () => {
        expect(loginDestination({ isOperator: false, role: UserRole.SUPERADMIN })).toBe('/post-login');
    });

    it('routes other staff roles to the staff dashboard', () => {
        for (const role of [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN]) {
            expect(loginDestination({ isOperator: false, role })).toBe('/dashboard');
        }
    });

    it('routes MANAGER to the vision board', () => {
        expect(loginDestination({ isOperator: false, role: UserRole.MANAGER })).toBe('/dashboard/vision');
    });

    it('falls back to the staff dashboard when role is unknown', () => {
        expect(loginDestination({ isOperator: false, role: null })).toBe('/dashboard');
    });
});
