import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared select-stub mutable state ────────────────────────────────────────

let mockRows: Array<{ key: string; value: unknown }> | null = [];
let mockError: { message: string } | null = null;

const mockSupabase = {
    from: vi.fn((_table: string) => ({
        select: vi.fn((_cols: string) => ({
            in: vi.fn(async (_col: string, _vals: string[]) => ({
                data: mockRows,
                error: mockError,
            })),
        })),
    })),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
    mockRows = [];
    mockError = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    vi.clearAllMocks();
    // Reset the module registry so `cache()` does not memoize across tests.
    vi.resetModules();
});

describe('feature-flags', () => {
    it('returns all true when all 5 rows are present and true', async () => {
        mockRows = [
            { key: 'feature.shipowner_portal_v1_enabled', value: true },
            { key: 'feature.shipowner_self_service_enabled', value: true },
            { key: 'feature.online_payment_stripe_enabled', value: true },
            { key: 'feature.wallet_topup_enabled', value: true },
            { key: 'feature.notification_sms_enabled', value: true },
        ];
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags).toEqual({
            portalV1Enabled: true,
            selfServiceEnabled: true,
            onlinePaymentStripeEnabled: true,
            onlinePaypalEnabled: false,
            walletTopupEnabled: true,
            notificationSmsEnabled: true,
            airSelfServiceEnabled: false,
        });
    });

    it('returns all false when no rows are present (defensive default)', async () => {
        mockRows = [];
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags).toEqual({
            portalV1Enabled: false,
            selfServiceEnabled: false,
            onlinePaymentStripeEnabled: false,
            onlinePaypalEnabled: false,
            walletTopupEnabled: false,
            notificationSmsEnabled: false,
            airSelfServiceEnabled: false,
        });
    });

    it('handles mixed presence — 3 rows present-and-true, 2 missing → correct mapping', async () => {
        mockRows = [
            { key: 'feature.shipowner_portal_v1_enabled', value: true },
            { key: 'feature.online_payment_stripe_enabled', value: true },
            { key: 'feature.wallet_topup_enabled', value: true },
            // self-service + sms missing → should default to false
        ];
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags).toEqual({
            portalV1Enabled: true,
            selfServiceEnabled: false,
            onlinePaymentStripeEnabled: true,
            onlinePaypalEnabled: false,
            walletTopupEnabled: true,
            notificationSmsEnabled: false,
            airSelfServiceEnabled: false,
        });
    });

    it('treats present-but-false rows as false (not missing)', async () => {
        mockRows = [
            { key: 'feature.shipowner_portal_v1_enabled', value: false },
            { key: 'feature.shipowner_self_service_enabled', value: false },
        ];
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags.portalV1Enabled).toBe(false);
        expect(flags.selfServiceEnabled).toBe(false);
    });

    it('treats non-boolean JSONB values as false (defensive)', async () => {
        // app_config.value is JSONB. If a row gets miswritten as a string or
        // number, the gate must not open. Strict === true required.
        mockRows = [
            { key: 'feature.shipowner_portal_v1_enabled', value: 'true' },
            { key: 'feature.online_payment_stripe_enabled', value: 1 },
        ];
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags.portalV1Enabled).toBe(false);
        expect(flags.onlinePaymentStripeEnabled).toBe(false);
    });

    it('defaults all to false when the SELECT errors', async () => {
        mockError = { message: 'db down' };
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags).toEqual({
            portalV1Enabled: false,
            selfServiceEnabled: false,
            onlinePaymentStripeEnabled: false,
            onlinePaypalEnabled: false,
            walletTopupEnabled: false,
            notificationSmsEnabled: false,
            airSelfServiceEnabled: false,
        });
    });

    it('defaults all to false when env vars are missing', async () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags.portalV1Enabled).toBe(false);
    });

    it('reads air_self_service_enabled (defaults false when absent)', async () => {
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags).toHaveProperty('airSelfServiceEnabled');
        expect(typeof flags.airSelfServiceEnabled).toBe('boolean');
    });

    it('isFeatureEnabled returns the right typed value', async () => {
        mockRows = [
            { key: 'feature.wallet_topup_enabled', value: true },
            { key: 'feature.shipowner_portal_v1_enabled', value: false },
        ];
        const { isFeatureEnabled } = await import('./feature-flags');
        // Both calls hit the same cached snapshot in-request; assert two
        // typed-key lookups against one read.
        expect(await isFeatureEnabled('walletTopupEnabled')).toBe(true);
        expect(await isFeatureEnabled('portalV1Enabled')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rail PayPal — 7e flag (mig 114). Meme politique fail-secure que les autres :
// seul un booleen JSONB strictement true ouvre la porte.
// ─────────────────────────────────────────────────────────────────────────────

describe('feature-flags — onlinePaypalEnabled', () => {
    it('false quand la cle est absente', async () => {
        mockRows = [];
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags.onlinePaypalEnabled).toBe(false);
    });

    it('true quand feature.online_payment_paypal_enabled vaut true', async () => {
        mockRows = [{ key: 'feature.online_payment_paypal_enabled', value: true }];
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags.onlinePaypalEnabled).toBe(true);
    });

    it('false sur une valeur JSONB non booleenne (defensif)', async () => {
        mockRows = [{ key: 'feature.online_payment_paypal_enabled', value: 'true' }];
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags.onlinePaypalEnabled).toBe(false);
    });

    it('independant du flag Stripe', async () => {
        mockRows = [{ key: 'feature.online_payment_stripe_enabled', value: true }];
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        const flags = await _readPortalFeatureFlagsImpl();
        expect(flags.onlinePaymentStripeEnabled).toBe(true);
        expect(flags.onlinePaypalEnabled).toBe(false);
    });

    it('la cle PayPal fait partie du SELECT unique (7 cles)', async () => {
        const { _readPortalFeatureFlagsImpl } = await import('./feature-flags');
        await _readPortalFeatureFlagsImpl();
        const inCall = mockSupabase.from.mock.results[0].value.select.mock.results[0].value.in;
        expect(inCall.mock.calls[0][1]).toContain('feature.online_payment_paypal_enabled');
        expect(inCall.mock.calls[0][1]).toHaveLength(7);
    });
});
