import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { requireRoleMock, flagsMock, setProviderActiveMock } = vi.hoisted(() => ({
    requireRoleMock: vi.fn(),
    flagsMock: vi.fn(),
    setProviderActiveMock: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireRole: requireRoleMock }));
vi.mock('@/lib/feature-flags', () => ({ readPortalFeatureFlags: flagsMock }));
vi.mock('@/services/paymentService', async () => {
    const actual = await vi.importActual<typeof import('@/services/paymentService')>('@/services/paymentService');
    return { ...actual, setProviderActive: setProviderActiveMock };
});

import { GET, PUT } from './route';

const savedKey = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    requireRoleMock.mockResolvedValue({
        supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) },
    });
    flagsMock.mockResolvedValue({ onlinePaymentStripeEnabled: false, onlinePaypalEnabled: true });
    setProviderActiveMock.mockResolvedValue(true);
});
afterEach(() => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedKey;
});

function put(body: unknown) {
    return PUT(new Request('http://localhost/api/admin/payment-config', {
        method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }) as never);
}

describe('GET /api/admin/payment-config', () => {
    it('expose les flags qui gouvernent les rails de checkout du portail', async () => {
        const body = await (await GET()).json();
        expect(body.checkoutFlags).toEqual({ stripe: false, paypal: true });
        expect(body.providers.find((p: { provider: string }) => p.provider === 'stripe').enabled).toBe(false);
    });
});

describe('PUT /api/admin/payment-config', () => {
    it("refuse d'activer un fournisseur dont la clé n'est pas chargée", async () => {
        const res = await put({ provider: 'stripe', isActive: true });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/STRIPE|stripe/);
        expect(setProviderActiveMock).not.toHaveBeenCalled();
    });

    it('active un fournisseur dont la clé est chargée', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
        const res = await put({ provider: 'stripe', isActive: true });
        expect(res.status).toBe(200);
        expect(setProviderActiveMock).toHaveBeenCalledWith(expect.anything(), 'stripe', true);
    });

    it('laisse toujours désactiver, clé ou pas', async () => {
        const res = await put({ provider: 'stripe', isActive: false });
        expect(res.status).toBe(200);
        expect(setProviderActiveMock).toHaveBeenCalledWith(expect.anything(), 'stripe', false);
    });
});
