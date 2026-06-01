import { describe, it, expect, vi, beforeEach } from 'vitest';

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
