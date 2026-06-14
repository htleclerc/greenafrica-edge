import { describe, it, expect } from 'vitest';
import { loginDestination } from './loginDestination';
import { UserRole } from '@/types/secure';

describe('loginDestination', () => {
    it('routes an operator (has shipowners row) to the operator shell', () => {
        // role is irrelevant for an operator — the shipowners row wins.
        expect(loginDestination({ isOperator: true, role: UserRole.PORT_OFFICER })).toBe('/owner/dashboard');
        expect(loginDestination({ isOperator: true, role: null })).toBe('/owner/dashboard');
    });

    it('routes a SUPERADMIN to the impersonation step', () => {
        expect(loginDestination({ isOperator: false, role: UserRole.SUPERADMIN })).toBe('/post-login');
    });

    it('routes other staff roles to the staff dashboard', () => {
        for (const role of [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.MANAGER]) {
            expect(loginDestination({ isOperator: false, role })).toBe('/dashboard');
        }
    });

    it('falls back to the staff dashboard when role is unknown', () => {
        expect(loginDestination({ isOperator: false, role: null })).toBe('/dashboard');
    });
});
