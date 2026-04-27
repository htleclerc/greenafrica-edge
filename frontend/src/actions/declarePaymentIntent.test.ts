import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const insertSpy = vi.fn((_payload: Record<string, unknown>) => ({
    select: () => ({
        single: () => Promise.resolve({ data: { id: 'intent-uuid' }, error: null }),
    }),
}));

let mockProfile: { role: string } | null = { role: 'SHIPOWNER' };
let mockUser: { id: string } | null = { id: 'owner-uuid' };

vi.mock('@/lib/supabase/server', () => ({
    createClient: () =>
        Promise.resolve({
            auth: {
                getUser: () => Promise.resolve({ data: { user: mockUser } }),
            },
            from: (table: string) => {
                if (table === 'profiles') {
                    return {
                        select: () => ({
                            eq: () => ({
                                single: () =>
                                    Promise.resolve({ data: mockProfile, error: null }),
                            }),
                        }),
                    };
                }
                if (table === 'shipowner_payment_intents') {
                    return { insert: insertSpy };
                }
                throw new Error(`unexpected table: ${table}`);
            },
        }),
}));

const { declarePaymentIntent } = await import('./declarePaymentIntent');

beforeEach(() => {
    insertSpy.mockClear();
    mockProfile = { role: 'SHIPOWNER' };
    mockUser = { id: 'owner-uuid' };
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('declarePaymentIntent', () => {
    const validInput = {
        transactionId: 'a1b2c3d4-e5f6-4789-9abc-def012345678',
        reference: 'WIRE-2026-00123',
        amountUsd: 12000,
        notes: 'Sender bank: BNP Paribas',
    };

    it('rejects unauthenticated callers', async () => {
        mockUser = null;
        const r = await declarePaymentIntent(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not authenticated/i);
    });

    it('rejects non-SHIPOWNER roles', async () => {
        mockProfile = { role: 'PORT_OFFICER' };
        const r = await declarePaymentIntent(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/only shipowners/i);
    });

    it('rejects malformed transactionId', async () => {
        const r = await declarePaymentIntent({ ...validInput, transactionId: 'not-a-uuid' });
        expect(r.ok).toBe(false);
    });

    it('rejects too-short reference', async () => {
        const r = await declarePaymentIntent({ ...validInput, reference: 'A' });
        expect(r.ok).toBe(false);
    });

    it('rejects negative amount', async () => {
        const r = await declarePaymentIntent({ ...validInput, amountUsd: -100 });
        expect(r.ok).toBe(false);
    });

    it('inserts an intent in DECLARED state on the happy path', async () => {
        const r = await declarePaymentIntent(validInput);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.intentId).toBe('intent-uuid');
        expect(insertSpy).toHaveBeenCalledTimes(1);
        const payload = insertSpy.mock.calls[0]![0];
        expect(payload).toMatchObject({
            transaction_id: validInput.transactionId,
            declared_by: 'owner-uuid',
            reference: validInput.reference,
            amount_usd: validInput.amountUsd,
            status: 'DECLARED',
        });
    });

    it('drops empty notes to null (not empty string)', async () => {
        await declarePaymentIntent({ ...validInput, notes: '' });
        const payload = insertSpy.mock.calls[0]![0] as { notes: unknown };
        expect(payload.notes).toBeNull();
    });
});
