import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const insertSpy = vi.fn((_payload: Record<string, unknown>) => ({
    select: () => ({
        single: () =>
            Promise.resolve({
                data: { id: 'dispute-uuid', ref: 'DSP-2026-000001' },
                error: null,
            }),
    }),
}));

let mockProfile: { role: string } | null = { role: 'SHIPOWNER' };
let mockUser: { id: string } | null = { id: 'owner-uuid' };
let mockTxn: { id: string; vessel_id: string; tax_amount_usd: number } | null = {
    id: 'txn-uuid',
    vessel_id: 'vessel-uuid',
    tax_amount_usd: 12000,
};

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
                if (table === 'transactions') {
                    return {
                        select: () => ({
                            eq: () => ({
                                single: () =>
                                    Promise.resolve({
                                        data: mockTxn,
                                        error: mockTxn ? null : { message: 'not found' },
                                    }),
                            }),
                        }),
                    };
                }
                if (table === 'disputes') {
                    return { insert: insertSpy };
                }
                throw new Error(`unexpected table: ${table}`);
            },
        }),
}));

const { createOwnerDispute } = await import('./createOwnerDispute');

beforeEach(() => {
    insertSpy.mockClear();
    mockProfile = { role: 'SHIPOWNER' };
    mockUser = { id: 'owner-uuid' };
    mockTxn = { id: 'txn-uuid', vessel_id: 'vessel-uuid', tax_amount_usd: 12000 };
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createOwnerDispute', () => {
    const validInput = {
        transactionId: 'a1b2c3d4-e5f6-4789-9abc-def012345678',
        reason: 'TAX_RATE',
        description:
            'The applied tax rate is higher than what was published in the gazette for this corridor.',
        evidenceUrl: '',
    };

    it('rejects unauthenticated callers', async () => {
        mockUser = null;
        const r = await createOwnerDispute(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not authenticated/i);
    });

    it('rejects non-SHIPOWNER roles', async () => {
        mockProfile = { role: 'SHIPPING_AGENT' };
        const r = await createOwnerDispute(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/only shipowners/i);
    });

    it('rejects unknown reason values', async () => {
        const r = await createOwnerDispute({ ...validInput, reason: 'NOT_AN_ENUM_VALUE' });
        expect(r.ok).toBe(false);
    });

    it('rejects descriptions shorter than 10 chars', async () => {
        const r = await createOwnerDispute({ ...validInput, description: 'too short' });
        expect(r.ok).toBe(false);
    });

    it('returns 404-style error when transaction not found (RLS-hidden)', async () => {
        mockTxn = null;
        const r = await createOwnerDispute(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not found|not yours/i);
        expect(insertSpy).not.toHaveBeenCalled();
    });

    it('inserts the dispute with vessel + amount fetched server-side', async () => {
        const r = await createOwnerDispute(validInput);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.disputeId).toBe('dispute-uuid');
            expect(r.ref).toBe('DSP-2026-000001');
        }
        const payload = insertSpy.mock.calls[0]![0];
        expect(payload).toMatchObject({
            transaction_id: 'txn-uuid',
            vessel_id: 'vessel-uuid',
            submitted_by: 'owner-uuid',
            reason: 'TAX_RATE',
            original_amount_usd: 12000,
            evidence_urls: [],
        });
    });

    it('passes evidenceUrl as a single-element array when provided', async () => {
        await createOwnerDispute({
            ...validInput,
            evidenceUrl: 'https://example.com/proof.pdf',
        });
        const payload = insertSpy.mock.calls[0]![0] as { evidence_urls: string[] };
        expect(payload.evidence_urls).toEqual(['https://example.com/proof.pdf']);
    });
});
