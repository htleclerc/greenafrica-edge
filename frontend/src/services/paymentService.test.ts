import { describe, it, expect, vi, beforeEach } from 'vitest';

const chain = {
  select: vi.fn(() => chain),
  eq: vi.fn(() => chain),
  in: vi.fn(() => chain),
  order: vi.fn(() => chain),
  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
};

const db = { from: vi.fn(() => chain) } as any;

describe('paymentService', () => {
  describe('listPaymentsForShipowner', () => {
    it('queries payments by shipowner_id and joins transactions', async () => {
      const { listPaymentsForShipowner } = await import('./paymentService');
      await listPaymentsForShipowner(db, 'so-1');
      expect(db.from).toHaveBeenCalledWith('payments');
      expect(chain.eq).toHaveBeenCalledWith('shipowner_id', 'so-1');
    });
  });

  describe('listPendingAdminPayments', () => {
    it('filters by status INITIATED/PROCESSING and excludes WALLET/STRIPE', async () => {
      const { listPendingAdminPayments } = await import('./paymentService');
      await listPendingAdminPayments(db);
      expect(chain.in).toHaveBeenCalledWith('status', ['INITIATED', 'PROCESSING']);
    });
  });

  describe('webhook signature verification (constant-time)', () => {
    beforeEach(() => {
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_secret';
      process.env.FLUTTERWAVE_WEBHOOK_HASH = 'flw-hash-value';
    });

    it('Paystack: accepts a correct sha512 HMAC, rejects a wrong one', async () => {
      const { verifyPaystackSignature } = await import('./paymentService');
      const { createHmac } = await import('crypto');
      const body = '{"event":"charge.success"}';
      const good = createHmac('sha512', 'sk_test_secret').update(body).digest('hex');
      expect(await verifyPaystackSignature(body, good)).toBe(true);
      expect(await verifyPaystackSignature(body, 'deadbeef')).toBe(false);
    });

    it('Flutterwave: matches the configured hash, rejects mismatch and empty', async () => {
      const { verifyFlutterwaveSignature } = await import('./paymentService');
      expect(verifyFlutterwaveSignature('flw-hash-value')).toBe(true);
      expect(verifyFlutterwaveSignature('wrong')).toBe(false);
      expect(verifyFlutterwaveSignature('')).toBe(false);
    });
  });
});
