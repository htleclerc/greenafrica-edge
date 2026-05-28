import { describe, it, expect, beforeEach } from 'vitest';
import { getLegacyPaymentMethods } from '../paymentService';

function clientWith(active: { provider: string }[]) {
    return {
        from: () => ({
            select: () => ({
                eq: () => ({
                    order: async () => ({ data: active }),
                }),
            }),
        }),
    } as never;
}

describe('getLegacyPaymentMethods', () => {
    beforeEach(() => {
        delete process.env.FLUTTERWAVE_SECRET_KEY;
        delete process.env.STRIPE_SECRET_KEY;
    });

    it('reports wire active and no online when only wire_transfer is active', async () => {
        const m = await getLegacyPaymentMethods(clientWith([{ provider: 'wire_transfer' }]));
        expect(m.wire.active).toBe(true);
        expect(m.online.active).toBe(false);
        expect(m.online.provider).toBeNull();
        expect(m.online.ready).toBe(false);
    });

    it('reports online active but NOT ready when the provider key is missing', async () => {
        const m = await getLegacyPaymentMethods(clientWith([{ provider: 'flutterwave' }, { provider: 'wire_transfer' }]));
        expect(m.online.active).toBe(true);
        expect(m.online.provider).toBe('flutterwave');
        expect(m.online.ready).toBe(false);
        expect(m.wire.active).toBe(true);
    });

    it('reports online ready when the provider key is present', async () => {
        process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-x';
        const m = await getLegacyPaymentMethods(clientWith([{ provider: 'flutterwave' }]));
        expect(m.online.active).toBe(true);
        expect(m.online.ready).toBe(true);
        expect(m.wire.active).toBe(false);
    });
});
