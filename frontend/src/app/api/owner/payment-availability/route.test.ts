import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    })),
}));
vi.mock('@/services/paymentService', () => ({
    selectProvidersForRail: vi.fn(async () => []),
}));
vi.mock('@/lib/feature-flags', () => ({
    readPortalFeatureFlags: vi.fn(),
}));

import { GET } from './route';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { selectProvidersForRail } from '@/services/paymentService';

interface RailEligibility {
    rail: string;
    eligible: boolean;
    providers: Array<{ provider: string }>;
    reason?: string;
}

function makeReq(): Request {
    return new Request('http://x/api/owner/payment-availability?walletBalanceUsdMinor=0&amountUsdMinor=0');
}

describe('GET /api/owner/payment-availability — Plan 7H-1 Task 5.2 STRIPE flag gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('STRIPE NOT eligible when STRIPE_SECRET_KEY is set but flag is OFF', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue({
            portalV1Enabled: true,
            selfServiceEnabled: true,
            onlinePaymentStripeEnabled: false,  // flag OFF
            walletTopupEnabled: true,
            notificationSmsEnabled: false,
        });

        const res = await GET(makeReq() as never);
        const body = await res.json() as { rails: RailEligibility[] };
        const stripe = body.rails.find((r) => r.rail === 'STRIPE');
        expect(stripe?.eligible).toBe(false);
        expect(stripe?.reason).toBe('no_active_provider');
        expect(stripe?.providers).toEqual([]);
    });

    it('STRIPE eligible when env is set AND flag is ON', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue({
            portalV1Enabled: true,
            selfServiceEnabled: true,
            onlinePaymentStripeEnabled: true,
            walletTopupEnabled: true,
            notificationSmsEnabled: false,
        });

        const res = await GET(makeReq() as never);
        const body = await res.json() as { rails: RailEligibility[] };
        const stripe = body.rails.find((r) => r.rail === 'STRIPE');
        expect(stripe?.eligible).toBe(true);
        expect(stripe?.providers.length).toBe(1);
        expect(stripe?.providers[0].provider).toBe('stripe');
    });

    it('STRIPE NOT eligible when env missing even if flag is ON', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue({
            portalV1Enabled: true,
            selfServiceEnabled: true,
            onlinePaymentStripeEnabled: true,
            walletTopupEnabled: true,
            notificationSmsEnabled: false,
        });

        const res = await GET(makeReq() as never);
        const body = await res.json() as { rails: RailEligibility[] };
        const stripe = body.rails.find((r) => r.rail === 'STRIPE');
        expect(stripe?.eligible).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rail PAYPAL — meme politique fail-secure que STRIPE : credentials en
// environnement ET feature flag app_config, les deux requis.
// ─────────────────────────────────────────────────────────────────────────────

const PAYPAL_ENV_KEYS = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] as const;

function flags(overrides: Record<string, boolean> = {}) {
    return {
        portalV1Enabled: true,
        selfServiceEnabled: true,
        onlinePaymentStripeEnabled: false,
        onlinePaypalEnabled: false,
        walletTopupEnabled: true,
        notificationSmsEnabled: false,
        airSelfServiceEnabled: false,
        ...overrides,
    };
}

describe('GET /api/owner/payment-availability — rail PAYPAL', () => {
    const savedPaypal: Record<string, string | undefined> = {};

    beforeEach(() => {
        vi.clearAllMocks();
        for (const k of PAYPAL_ENV_KEYS) savedPaypal[k] = process.env[k];
    });

    afterEach(() => {
        for (const k of PAYPAL_ENV_KEYS) {
            if (savedPaypal[k] === undefined) delete process.env[k];
            else process.env[k] = savedPaypal[k];
        }
    });

    function paypalOf(body: { rails: RailEligibility[] }) {
        return body.rails.find((r) => r.rail === 'PAYPAL');
    }

    it('eligible quand les credentials et le flag sont presents', async () => {
        process.env.PAYPAL_CLIENT_ID = 'cid';
        process.env.PAYPAL_CLIENT_SECRET = 'csecret';
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue(
            flags({ onlinePaypalEnabled: true }),
        );

        const res = await GET(makeReq() as never);
        const paypal = paypalOf(await res.json());
        expect(paypal?.eligible).toBe(true);
        expect(paypal?.providers).toEqual([
            { provider: 'paypal', routes_rail: ['PAYPAL'], display_order: 0 },
        ]);
        expect(paypal?.reason).toBeUndefined();
    });

    it('ineligible quand le flag est OFF, meme avec les credentials', async () => {
        process.env.PAYPAL_CLIENT_ID = 'cid';
        process.env.PAYPAL_CLIENT_SECRET = 'csecret';
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue(
            flags({ onlinePaypalEnabled: false }),
        );

        const res = await GET(makeReq() as never);
        const paypal = paypalOf(await res.json());
        expect(paypal?.eligible).toBe(false);
        expect(paypal?.reason).toBe('no_active_provider');
        expect(paypal?.providers).toEqual([]);
    });

    it('ineligible quand le secret manque, meme avec le flag ON', async () => {
        process.env.PAYPAL_CLIENT_ID = 'cid';
        delete process.env.PAYPAL_CLIENT_SECRET;
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue(
            flags({ onlinePaypalEnabled: true }),
        );

        const res = await GET(makeReq() as never);
        expect(paypalOf(await res.json())?.eligible).toBe(false);
    });

    it('ne consulte pas payment_config pour PAYPAL ni STRIPE', async () => {
        process.env.PAYPAL_CLIENT_ID = 'cid';
        process.env.PAYPAL_CLIENT_SECRET = 'csecret';
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue(
            flags({ onlinePaypalEnabled: true }),
        );

        await GET(makeReq() as never);

        const railsQueried = (selectProvidersForRail as ReturnType<typeof vi.fn>).mock.calls.map(
            (c) => c[1],
        );
        expect(railsQueried).not.toContain('PAYPAL');
        expect(railsQueried).not.toContain('STRIPE');
        expect(railsQueried).toEqual(['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY']);
    });
});
