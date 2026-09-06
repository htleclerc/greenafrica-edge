import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { checkoutSessionsCreate, paymentIntentsRetrieve, webhooksConstructEvent } = vi.hoisted(
    () => ({
        checkoutSessionsCreate: vi.fn(),
        paymentIntentsRetrieve: vi.fn(),
        webhooksConstructEvent: vi.fn(),
    }),
);

vi.mock('stripe', () => {
    function StripeMock(this: unknown) {
        Object.assign(this as Record<string, unknown>, {
            checkout: { sessions: { create: checkoutSessionsCreate } },
            paymentIntents: { retrieve: paymentIntentsRetrieve },
            webhooks: { constructEvent: webhooksConstructEvent },
        });
    }
    return { default: StripeMock };
});

describe('stripeService', () => {
    beforeEach(async () => {
        checkoutSessionsCreate.mockReset();
        paymentIntentsRetrieve.mockReset();
        webhooksConstructEvent.mockReset();
        vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_dummy');
        const { __resetStripeClientForTests } = await import('./stripeService');
        __resetStripeClientForTests();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('createCheckoutSession', () => {
        // La page de paiement affichait « Carbon Tax Invoice <uuid> » : un
        // armateur ne pouvait rapprocher cette ligne d'aucune pro-forma, ni sur
        // l'ecran ni sur son releve bancaire.
        it('libelle la ligne avec la reference de pro-forma, jamais avec l uuid', async () => {
            checkoutSessionsCreate.mockResolvedValueOnce({
                id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1', payment_intent: 'pi_1',
            });
            const { createCheckoutSession } = await import('./stripeService');
            await createCheckoutSession({
                amountUsdMinor: 2987160,
                paymentId: 'pay-1',
                invoiceId: 'd0ea310d-123e-4c1c-a983-aed94788e336',
                invoiceRef: 'PRO-2026-36-a1b2c3',
                shipownerId: 'so-1',
                successUrl: 'https://app.example.com/ok',
                cancelUrl: 'https://app.example.com/ko',
            });
            const arg = checkoutSessionsCreate.mock.calls[0][0] as {
                line_items: Array<{ price_data: { product_data: { name: string } } }>;
                metadata: Record<string, string>;
            };
            const name = arg.line_items[0].price_data.product_data.name;
            expect(name).toContain('PRO-2026-36-a1b2c3');
            expect(name).not.toContain('d0ea310d');
            // L'uuid reste en metadonnees : c'est lui qui porte la reconciliation.
            expect(arg.metadata.invoice_id).toBe('d0ea310d-123e-4c1c-a983-aed94788e336');
        });

        it('returns checkoutUrl, stripePaymentIntentId, stripeSessionId on happy path', async () => {
            checkoutSessionsCreate.mockResolvedValueOnce({
                id: 'cs_test_123',
                url: 'https://checkout.stripe.com/c/pay/cs_test_123',
                payment_intent: 'pi_test_456',
            });
            const { createCheckoutSession } = await import('./stripeService');
            const result = await createCheckoutSession({
                amountUsdMinor: 12345,
                paymentId: 'pay-1',
                invoiceId: 'inv-1',
                invoiceRef: 'PRO-2026-36-a1b2c3',
                shipownerId: 'so-1',
                successUrl: 'https://app.example.com/owner/payment/success',
                cancelUrl: 'https://app.example.com/owner/payment/cancel',
            });
            expect(result).toEqual({
                checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
                stripePaymentIntentId: 'pi_test_456',
                stripeSessionId: 'cs_test_123',
            });
            expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);
            // Managed Payments desactive : sinon Stripe rejette
            // payment_method_types et exige un tax_code produit.
            expect(checkoutSessionsCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    managed_payments: { enabled: false },
                    payment_method_types: ['card'],
                }),
            );
        });

        it('returns a null PaymentIntent when Stripe has not created one yet', async () => {
            // API 2026-04-22 : le PI n'existe qu'a la validation de l'acheteur.
            checkoutSessionsCreate.mockResolvedValueOnce({
                id: 'cs_test_123',
                url: 'https://checkout.stripe.com/c/pay/cs_test_123',
                payment_intent: null,
            });
            const { createCheckoutSession } = await import('./stripeService');
            const result = await createCheckoutSession({
                amountUsdMinor: 12345,
                paymentId: 'pay-1',
                invoiceId: 'inv-1',
                invoiceRef: 'PRO-2026-36-a1b2c3',
                shipownerId: 'so-1',
                successUrl: 'https://app.example.com/owner/payment/success',
                cancelUrl: 'https://app.example.com/owner/payment/cancel',
            });
            expect(result.stripePaymentIntentId).toBeNull();
            expect(result.stripeSessionId).toBe('cs_test_123');
        });

        it('throws when STRIPE_SECRET_KEY is missing', async () => {
            vi.stubEnv('STRIPE_SECRET_KEY', '');
            const { createCheckoutSession } = await import('./stripeService');
            await expect(
                createCheckoutSession({
                    amountUsdMinor: 100,
                    paymentId: 'pay-1',
                    invoiceId: 'inv-1',
                invoiceRef: 'PRO-2026-36-a1b2c3',
                    shipownerId: 'so-1',
                    successUrl: 'https://x/y',
                    cancelUrl: 'https://x/z',
                }),
            ).rejects.toThrow(/STRIPE_SECRET_KEY/);
        });
    });

    describe('retrievePaymentIntent', () => {
        it('returns the PaymentIntent', async () => {
            paymentIntentsRetrieve.mockResolvedValueOnce({
                id: 'pi_test_456',
                status: 'succeeded',
                amount: 12345,
            });
            const { retrievePaymentIntent } = await import('./stripeService');
            const pi = await retrievePaymentIntent('pi_test_456');
            expect(pi.id).toBe('pi_test_456');
            expect(paymentIntentsRetrieve).toHaveBeenCalledWith('pi_test_456');
        });
    });

    describe('verifyWebhookSignature', () => {
        it('returns parsed event when signature is valid', async () => {
            const event = { id: 'evt_1', type: 'payment_intent.succeeded' };
            webhooksConstructEvent.mockReturnValueOnce(event);
            const { verifyWebhookSignature } = await import('./stripeService');
            const result = verifyWebhookSignature('payload-bytes', 'sig-header');
            expect(result).toEqual(event);
            expect(webhooksConstructEvent).toHaveBeenCalledWith(
                'payload-bytes',
                'sig-header',
                'whsec_dummy',
            );
        });

        it('throws when STRIPE_WEBHOOK_SECRET is missing', async () => {
            vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
            const { verifyWebhookSignature } = await import('./stripeService');
            expect(() => verifyWebhookSignature('payload', 'sig')).toThrow(
                /STRIPE_WEBHOOK_SECRET/,
            );
        });
    });
});
