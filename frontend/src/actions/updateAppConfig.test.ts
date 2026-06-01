import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @/lib/supabase/server (used for auth + RBAC) ───────────────────────

let authUser: { id: string } | null = { id: 'admin-uuid' };
let profile: { role: string } | null = { role: 'SUPERADMIN' };

const serverClient = {
    auth: { getUser: vi.fn(async () => ({ data: { user: authUser } })) },
    from: vi.fn((_table: string) => ({
        select: () => ({
            eq: () => ({
                single: async () => ({ data: profile }),
            }),
        }),
    })),
};

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => serverClient),
}));

// ── Mock @supabase/supabase-js service-role (used for the UPSERT) ───────────

interface UpsertCall {
    table: string;
    values: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
}
const upserts: UpsertCall[] = [];
let upsertError: { message: string } | null = null;

const serviceClient = {
    from: vi.fn((table: string) => ({
        upsert: async (
            values: Record<string, unknown>,
            options?: Record<string, unknown>,
        ) => {
            upserts.push({ table, values, options });
            return { error: upsertError };
        },
    })),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => serviceClient),
}));

beforeEach(() => {
    upserts.length = 0;
    upsertError = null;
    authUser = { id: 'admin-uuid' };
    profile = { role: 'SUPERADMIN' };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    vi.clearAllMocks();
});

describe('updateAppConfig — Plan 7H-1 feature flag keys (Task 3)', () => {
    const NEW_FLAG_KEYS = [
        'feature.shipowner_portal_v1_enabled',
        'feature.shipowner_self_service_enabled',
        'feature.online_payment_stripe_enabled',
        'feature.wallet_topup_enabled',
        'feature.notification_sms_enabled',
    ] as const;

    for (const key of NEW_FLAG_KEYS) {
        it(`accepts ${key} as an allowlisted writable boolean`, async () => {
            const { updateAppConfig } = await import('./updateAppConfig');
            const res = await updateAppConfig({ key, value: true });
            expect(res).toEqual({ ok: true });
            const call = upserts.find((u) => u.table === 'app_config');
            expect(call).toBeDefined();
            expect(call?.values.key).toBe(key);
            // JSONB round-trip preserves boolean
            expect(call?.values.value).toBe(true);
            expect(call?.options).toEqual({ onConflict: 'key' });
        });
    }

    it('rejects keys not in the allowlist', async () => {
        const { updateAppConfig } = await import('./updateAppConfig');
        const res = await updateAppConfig({
            key: 'feature.not_a_real_key',
            value: true,
        });
        expect(res).toEqual({ ok: false, reason: 'key not allowlisted' });
        expect(upserts).toHaveLength(0);
    });

    it('rejects non-SUPERADMIN callers', async () => {
        profile = { role: 'FINANCE_ADMIN' };
        const { updateAppConfig } = await import('./updateAppConfig');
        const res = await updateAppConfig({
            key: 'feature.shipowner_portal_v1_enabled',
            value: true,
        });
        expect(res).toEqual({
            ok: false,
            reason: 'only SUPERADMIN can edit tax settings',
        });
        expect(upserts).toHaveLength(0);
    });

    it('rejects unauthenticated callers', async () => {
        authUser = null;
        const { updateAppConfig } = await import('./updateAppConfig');
        const res = await updateAppConfig({
            key: 'feature.wallet_topup_enabled',
            value: false,
        });
        expect(res).toEqual({ ok: false, reason: 'not authenticated' });
        expect(upserts).toHaveLength(0);
    });
});
