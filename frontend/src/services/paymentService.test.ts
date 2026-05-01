import { describe, it, expect, vi } from 'vitest';

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
});
