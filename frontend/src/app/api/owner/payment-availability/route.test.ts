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
            showUnavailableRails: true,  // ces tests portent sur le calcul d'eligibilite, pas sur le filtrage
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
            showUnavailableRails: true,  // ces tests portent sur le calcul d'eligibilite, pas sur le filtrage
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
            showUnavailableRails: true,  // ces tests portent sur le calcul d'eligibilite, pas sur le filtrage
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
            showUnavailableRails: true,  // ces tests portent sur le calcul d'eligibilite, pas sur le filtrage
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

describe('filtrage des rails indisponibles', () => {
    beforeEach(() => vi.clearAllMocks());

    function flags(showUnavailableRails: boolean) {
        return {
            portalV1Enabled: true,
            selfServiceEnabled: true,
            onlinePaymentStripeEnabled: false,
            onlinePaypalEnabled: false,
            walletTopupEnabled: true,
            notificationSmsEnabled: false,
            airSelfServiceEnabled: false,
            showUnavailableRails,
        };
    }

    it('drapeau ETEINT : aucun rail sans prestataire actif ne descend au navigateur', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue(flags(false));
        (selectProvidersForRail as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const body = await (await GET(makeReq() as never)).json();
        const rails = body.rails as RailEligibility[];

        // Le filtrage se fait cote serveur : masquer a l'affichage laisserait
        // l'information dans la charge utile.
        expect(rails.some((r) => r.reason === 'no_active_provider')).toBe(false);
        expect(body.showUnavailable).toBe(false);
    });

    it('drapeau ETEINT : le portefeuille reste visible avec son motif', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue(flags(false));
        (selectProvidersForRail as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const body = await (await GET(makeReq() as never)).json();
        const wallet = (body.rails as RailEligibility[]).find((r) => r.rail === 'WALLET');

        // « Solde insuffisant » est actionnable : le masquer laisserait croire
        // que le moyen n'existe pas, et l'armateur ne l'alimenterait jamais.
        expect(wallet).toBeDefined();
        expect(wallet?.eligible).toBe(false);
        expect(wallet?.reason).toBe('wallet_empty');
    });

    it('drapeau ALLUME : les rails inactifs redescendent, marquables « bientot »', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue(flags(true));
        (selectProvidersForRail as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const body = await (await GET(makeReq() as never)).json();
        const rails = body.rails as RailEligibility[];

        expect(rails.filter((r) => r.reason === 'no_active_provider').length).toBeGreaterThan(0);
        expect(body.showUnavailable).toBe(true);
    });

    it('un rail eligible passe quel que soit le drapeau', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
        const withStripe = { ...flags(false), onlinePaymentStripeEnabled: true };
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue(withStripe);
        (selectProvidersForRail as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const body = await (await GET(makeReq() as never)).json();
        const stripe = (body.rails as RailEligibility[]).find((r) => r.rail === 'STRIPE');
        expect(stripe?.eligible).toBe(true);
    });
});
