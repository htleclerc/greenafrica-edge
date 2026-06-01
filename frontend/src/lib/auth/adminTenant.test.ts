import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertAdminCanActOn } from './adminTenant';
import { UserRole, type SecureUser } from '@/types/secure';

const SO = '00000000-0000-4000-8000-00000000534f';
const SN = '11111111-1111-4111-8111-111111111111';

const getJidMock = vi.fn();
vi.mock('@/lib/auth/tenantContext', () => ({
    getServerJurisdictionId: () => getJidMock(),
}));

function admin(role: UserRole): SecureUser {
    return { id: 'admin-1', role } as unknown as SecureUser;
}

beforeEach(() => {
    getJidMock.mockReset();
});

describe('assertAdminCanActOn', () => {
    it('SUPERADMIN may act on any jurisdiction (returns the entity jurisdiction, no lookup)', async () => {
        await expect(assertAdminCanActOn(admin(UserRole.SUPERADMIN), SN)).resolves.toBe(SN);
        expect(getJidMock).not.toHaveBeenCalled();
    });

    it('FINANCE_ADMIN may act within their own jurisdiction', async () => {
        getJidMock.mockResolvedValue(SO);
        await expect(assertAdminCanActOn(admin(UserRole.FINANCE_ADMIN), SO)).resolves.toBe(SO);
    });

    it('FINANCE_ADMIN cannot act on another jurisdiction (staff isolation)', async () => {
        getJidMock.mockResolvedValue(SO);
        await expect(assertAdminCanActOn(admin(UserRole.FINANCE_ADMIN), SN)).rejects.toThrow(
            /another jurisdiction/,
        );
    });
});
