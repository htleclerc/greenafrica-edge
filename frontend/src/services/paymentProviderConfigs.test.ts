import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAllProviderConfigs, isProviderConfigured, looksLikeTestKey } from './paymentService';

const ENV_KEYS = ['STRIPE_SECRET_KEY', 'PAYSTACK_SECRET_KEY', 'FLUTTERWAVE_SECRET_KEY', 'WAVE_API_KEY', 'PAYONEER_API_KEY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
});

/** `payment_config` telle que la mig 011 l'a seedée : Stripe désactivé, en test. */
function db(rows: Record<string, unknown>[]) {
    return {
        from: () => ({ select: () => ({ order: async () => ({ data: rows, error: null }) }) }),
    } as never;
}
const SEED = [
    { provider: 'stripe', is_enabled: false, is_active: false, test_mode: true, routes_rail: ['STRIPE'] },
    { provider: 'wire_transfer', is_enabled: true, is_active: true, test_mode: false, routes_rail: ['WIRE_TRANSFER'] },
];

describe('looksLikeTestKey', () => {
    it('reconnaît les clés de bac à sable des fournisseurs', () => {
        expect(looksLikeTestKey('sk_test_51H…')).toBe(true);
        expect(looksLikeTestKey('FLWSECK_TEST-abc')).toBe(true);
        expect(looksLikeTestKey('sk_live_51H…')).toBe(false);
        expect(looksLikeTestKey('FLWSECK-abc')).toBe(false);
    });
});

describe('getAllProviderConfigs', () => {
    it("lit « configuré » dans l'environnement, pas dans la colonne seedée", async () => {
        // En prod, Stripe restait « Add API key to .env » et verrouillé avec la
        // clé live chargée, parce que `is_enabled` seedé à false n'était jamais réécrit.
        process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
        const stripe = (await getAllProviderConfigs(db(SEED))).find((p) => p.provider === 'stripe')!;
        expect(stripe.enabled).toBe(true);
        expect(stripe.testMode).toBe(false);
        expect(stripe.envKey).toBe('STRIPE_SECRET_KEY');
    });

    it('signale le mode test depuis la clé, quoi que dise la table', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
        const stripe = (await getAllProviderConfigs(db([{ ...SEED[0], test_mode: false }])))
            .find((p) => p.provider === 'stripe')!;
        expect(stripe.testMode).toBe(true);
    });

    it('sans clé : non configuré, pas de badge test, bouton à verrouiller', async () => {
        const stripe = (await getAllProviderConfigs(db(SEED))).find((p) => p.provider === 'stripe')!;
        expect(stripe.enabled).toBe(false);
        expect(stripe.testMode).toBe(false);
    });

    it("le virement n'a pas de clé et reste toujours disponible", async () => {
        const wire = (await getAllProviderConfigs(db(SEED))).find((p) => p.provider === 'wire_transfer')!;
        expect(wire.enabled).toBe(true);
        expect(wire.isDefault).toBe(true);
        expect(wire.envKey).toBe('');
    });

    it("garde le choix de l'admin (is_active) depuis la table", async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
        const stripe = (await getAllProviderConfigs(db([{ ...SEED[0], is_active: true }])))
            .find((p) => p.provider === 'stripe')!;
        expect(stripe.isDefault).toBe(true);
    });
});

describe('isProviderConfigured', () => {
    it('suit la présence de la clé', () => {
        expect(isProviderConfigured('stripe')).toBe(false);
        process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
        expect(isProviderConfigured('stripe')).toBe(true);
        expect(isProviderConfigured('wire_transfer')).toBe(true);
    });
});
