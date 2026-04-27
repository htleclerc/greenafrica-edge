import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

interface IntentUpdatePayload {
    status?: string;
    resolved_by?: string;
    resolved_at?: string;
    resolution_note?: string | null;
}

interface TxnUpdatePayload {
    status?: string;
    collections_status?: string;
    paid_at?: string;
}

const intentUpdateSpy = vi.fn((_p: IntentUpdatePayload) => ({
    eq: () => Promise.resolve({ error: null }),
}));
const txnUpdateSpy = vi.fn((_p: TxnUpdatePayload) => ({
    eq: () => ({
        select: () => ({
            single: () =>
                Promise.resolve({
                    data: {
                        vessel_id: 'vessel-uuid',
                        vessel_name: 'MV Test',
                        tax_amount_usd: 12000,
                    },
                    error: null,
                }),
        }),
    }),
}));
const vesselUpdateSpy = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
const auditInsertSpy = vi.fn(() => Promise.resolve({ error: null }));

let callerProfile: { role: string; full_name: string | null } | null = {
    role: 'FINANCE_ADMIN',
    full_name: 'Finance Admin',
};
let callerUser: { id: string } | null = { id: 'admin-uuid' };
let mockIntent: {
    id: string;
    transaction_id: string;
    status: string;
    amount_usd: number;
} | null = {
    id: 'intent-uuid',
    transaction_id: 'txn-uuid',
    status: 'DECLARED',
    amount_usd: 12000,
};

vi.mock('@/lib/supabase/server', () => ({
    createClient: () =>
        Promise.resolve({
            auth: {
                getUser: () => Promise.resolve({ data: { user: callerUser } }),
            },
            from: (table: string) => {
                if (table === 'profiles') {
                    return {
                        select: () => ({
                            eq: () => ({
                                single: () =>
                                    Promise.resolve({ data: callerProfile, error: null }),
                            }),
                        }),
                    };
                }
                throw new Error(`unexpected table on user client: ${table}`);
            },
        }),
}));

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({
        from: (table: string) => {
            if (table === 'shipowner_payment_intents') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: () =>
                                Promise.resolve({
                                    data: mockIntent,
                                    error: mockIntent ? null : { message: 'not found' },
                                }),
                        }),
                    }),
                    update: (payload: IntentUpdatePayload) => {
                        intentUpdateSpy(payload);
                        return { eq: () => Promise.resolve({ error: null }) };
                    },
                };
            }
            if (table === 'transactions') {
                return {
                    update: (payload: TxnUpdatePayload) => {
                        txnUpdateSpy(payload);
                        return {
                            eq: () => ({
                                select: () => ({
                                    single: () =>
                                        Promise.resolve({
                                            data: {
                                                vessel_id: 'vessel-uuid',
                                                vessel_name: 'MV Test',
                                                tax_amount_usd: 12000,
                                            },
                                            error: null,
                                        }),
                                }),
                            }),
                        };
                    },
                };
            }
            if (table === 'vessels') {
                return { update: vesselUpdateSpy };
            }
            if (table === 'audit_logs') {
                return { insert: auditInsertSpy };
            }
            throw new Error(`unexpected table on admin client: ${table}`);
        },
    }),
}));

const { resolvePaymentIntent } = await import('./resolvePaymentIntent');

beforeEach(() => {
    intentUpdateSpy.mockClear();
    txnUpdateSpy.mockClear();
    vesselUpdateSpy.mockClear();
    auditInsertSpy.mockClear();
    callerProfile = { role: 'FINANCE_ADMIN', full_name: 'Finance Admin' };
    callerUser = { id: 'admin-uuid' };
    mockIntent = {
        id: 'intent-uuid',
        transaction_id: 'txn-uuid',
        status: 'DECLARED',
        amount_usd: 12000,
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sk_test';
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolvePaymentIntent', () => {
    const validInput = {
        intentId: 'a1b2c3d4-e5f6-4789-9abc-def012345678',
        action: 'confirm' as const,
    };

    it('rejects unauthenticated callers', async () => {
        callerUser = null;
        const r = await resolvePaymentIntent(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not authenticated/i);
    });

    it('rejects non-finance roles (SHIPOWNER refused)', async () => {
        callerProfile = { role: 'SHIPOWNER', full_name: 'X' };
        const r = await resolvePaymentIntent(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/insufficient role/i);
    });

    it('refuses an already-resolved intent', async () => {
        mockIntent = { ...mockIntent!, status: 'CONFIRMED' };
        const r = await resolvePaymentIntent(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/already confirmed/i);
        expect(intentUpdateSpy).not.toHaveBeenCalled();
    });

    it('confirm path — flips intent + transaction (PAID + collections_status=PAID)', async () => {
        const r = await resolvePaymentIntent(validInput);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.transactionPaid).toBe(true);

        // intent first, then transaction
        const intentPayload = intentUpdateSpy.mock.calls[0]![0];
        expect(intentPayload).toMatchObject({
            status: 'CONFIRMED',
            resolved_by: 'admin-uuid',
        });

        const txnPayload = txnUpdateSpy.mock.calls[0]![0];
        expect(txnPayload).toMatchObject({
            status: 'PAID',
            collections_status: 'PAID',
        });
        expect(txnPayload.paid_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // vessel compliance + audit log fired
        expect(vesselUpdateSpy).toHaveBeenCalledTimes(1);
        expect(auditInsertSpy).toHaveBeenCalledTimes(1);
    });

    it('reject path — flips intent only, NO transaction or vessel update', async () => {
        const r = await resolvePaymentIntent({
            ...validInput,
            action: 'reject',
            resolutionNote: 'Reference not found in bank statement',
        });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.transactionPaid).toBe(false);

        const intentPayload = intentUpdateSpy.mock.calls[0]![0];
        expect(intentPayload).toMatchObject({
            status: 'REJECTED',
            resolution_note: 'Reference not found in bank statement',
        });

        expect(txnUpdateSpy).not.toHaveBeenCalled();
        expect(vesselUpdateSpy).not.toHaveBeenCalled();
        expect(auditInsertSpy).not.toHaveBeenCalled();
    });

    it('rejects malformed intentId', async () => {
        const r = await resolvePaymentIntent({ ...validInput, intentId: 'not-a-uuid' });
        expect(r.ok).toBe(false);
    });

    it('rejects unknown action value', async () => {
        const r = await resolvePaymentIntent({
            ...validInput,
            action: 'whatever' as never,
        });
        expect(r.ok).toBe(false);
    });
});
