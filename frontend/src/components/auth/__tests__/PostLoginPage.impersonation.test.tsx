import { describe, it, expect, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser: vi.fn() } }) }));

import { __IMPERSONATION_ROLES_FOR_TEST } from '../PostLoginPage';
import { UserRole } from '@/types/secure';

describe('PostLoginPage impersonation roles', () => {
    it('no longer offers SHIPPING_AGENT (armateurs now use the /owner portal)', () => {
        const keys = __IMPERSONATION_ROLES_FOR_TEST.map((r) => r.key);
        expect(keys).not.toContain(UserRole.SHIPPING_AGENT);
        expect(keys).toContain(UserRole.PORT_OFFICER);
        expect(keys).toContain(UserRole.FINANCE_ADMIN);
    });
});
