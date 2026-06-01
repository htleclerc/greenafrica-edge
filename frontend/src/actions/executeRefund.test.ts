import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 6: executeRefund tests
//
// Covers all 5 rail-specific branches + auth + state guards + fail-soft notify.
// Mocks: requireRole, getRefundById (refundService), createRefund (stripeService),
// notifyOwner (notificationService), Supabase client (chainable from/select/update/
// insert mock for refunds / wallets / wallet_ledger / payments / audit_logs).
// ─────────────────────────────────────────────────────────────────────────────

interface UpdateCall {
    table: string;
    payload: Record<string, unknown>;
    eqColumns: { col: string; val: unknown }[];
}
interface InsertCall {
    table: string;
    payload: Record<string, unknown>;
}
interface SelectCall {
    table: string;
    columns: string;
}

// Mutable fixtures — reset in beforeEach
let refundFixture: Record<string, unknown> | null = null;
let originalStripePayment: Record<string, unknown> | null = null;
let walletRow: Record<string, unknown> | null = null;
let updatedRefundRows: Record<string, unknown>[] = [{ id: 'refund-1' }];
let requireRoleResult: { user: { id: string; fullName: string; role: string } | null; supabase: unknown; error: unknown } = {
    user: { id: 'admin-1', fullName: 'Admin One', role: 'SUPERADMIN' },
    supabase: null,
    error: null,
};

const updateCalls: UpdateCall[] = [];
const insertCalls: InsertCall[] = [];
const selectCalls: SelectCall[] = [];
const notifyCalls: Record<string, unknown>[] = [];

// Stripe mock — can be made to throw via mockRejectedValueOnce
const createRefundMock = vi.fn();
const notifyOwnerMock = vi.fn();

const mockSupabase = {
    from: vi.fn((table: string) => {
        // ── payments: SELECT one (original Stripe payment lookup) ────────────
        if (table === 'payments') {
            return {
                select: (columns: string) => {
                    selectCalls.push({ table, columns });
                    return {
                        eq: () => ({
                            eq: () => ({
                                eq: () => ({
                                    limit: () => ({
                                        maybeSingle: async () => ({ data: originalStripePayment, error: null }),
                                    }),
                                }),
                            }),
                        }),
                    };
                },
            };
        }
        // ── wallets: SELECT one by shipowner_id ──────────────────────────────
        if (table === 'wallets') {
            return {
                select: (columns: string) => {
                    selectCalls.push({ table, columns });
                    return {
                        eq: () => ({
                            maybeSingle: async () => ({ data: walletRow, error: null }),
                        }),
                    };
                },
            };
        }
        // ── wallet_ledger: INSERT ────────────────────────────────────────────
        if (table === 'wallet_ledger') {
            return {
                insert: async (payload: Record<string, unknown>) => {
                    insertCalls.push({ table, payload });
                    return { data: { id: 'ledger-1' }, error: null };
                },
            };
        }
        // ── refunds: UPDATE with .eq().eq() race guard ───────────────────────
        if (table === 'refunds') {
            return {
                update: (payload: Record<string, unknown>) => {
                    const call: UpdateCall = { table, payload, eqColumns: [] };
                    updateCalls.push(call);
                    const builder: any = {
                        eq: (col: string, val: unknown) => {
                            call.eqColumns.push({ col, val });
                            return builder;
                        },
                        select: () => Promise.resolve({ data: updatedRefundRows, error: null }),
                    };
                    return builder;
                },
            };
        }
        // ── audit_logs: INSERT ───────────────────────────────────────────────
        if (table === 'audit_logs') {
            return {
                insert: async (payload: Record<string, unknown>) => {
                    insertCalls.push({ table, payload });
                    return { error: null };
                },
            };
        }
        return {} as never;
    }),
};

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockSupabase),
    createTenantClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => requireRoleResult),
}));

vi.mock('@/services/refundService', () => ({
    getRefundById: vi.fn(async () => refundFixture),
}));

vi.mock('@/services/stripeService', () => ({
    createRefund: createRefundMock,
}));

vi.mock('@/services/notificationService', () => ({
    notifyOwner: notifyOwnerMock,
}));

beforeEach(() => {
    refundFixture = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        status: 'REQUESTED',
        transaction_id: 'tx-1',
        shipowner_id: 'so-1',
        jurisdiction_id: 'so-juris',
        amount_usd_minor: 100000,
        refund_rail: null,
        rail_details: {},
        transaction: { invoice_ref: 'INV-001', vessel_name: 'MV Test', document_type: 'PROFORMA', tax_amount_usd: 1000 },
        shipowner: { name: 'Owner Co', official_email: 'owner@example.com' },
    };
    originalStripePayment = { id: 'pay-stripe-1', external_reference: 'pi_test_123' };
    walletRow = { id: 'wallet-1' };
    updatedRefundRows = [{ id: 'refund-1' }];
    requireRoleResult = {
        user: { id: 'admin-1', fullName: 'Admin One', role: 'SUPERADMIN' },
        supabase: null,
        error: null,
    };
    updateCalls.length = 0;
    insertCalls.length = 0;
    selectCalls.length = 0;
    notifyCalls.length = 0;
    createRefundMock.mockReset();
    notifyOwnerMock.mockReset();
    notifyOwnerMock.mockImplementation(async (_client: unknown, input: Record<string, unknown>) => {
        notifyCalls.push(input);
        return { id: 'notif-1' };
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    vi.clearAllMocks();
});

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('executeRefund', () => {
    // ─── Auth ────────────────────────────────────────────────────────────────
    it('rejects callers without FINANCE_ADMIN or SUPERADMIN role', async () => {
        requireRoleResult = { user: null, supabase: null, error: { status: 403 } };
        const { executeRefund } = await import('./executeRefund');
        await expect(executeRefund({ refundId: VALID_UUID }))
            .rejects.toThrow(/not authorized/i);
    });

    // ─── Schema ──────────────────────────────────────────────────────────────
    it('rejects non-uuid refundId', async () => {
        const { executeRefund } = await import('./executeRefund');
        await expect(executeRefund({ refundId: 'not-a-uuid' }))
            .rejects.toThrow();
    });

    // ─── Lookup ──────────────────────────────────────────────────────────────
    it('returns error when refund not found', async () => {
        refundFixture = null;
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/not found/i);
    });

    // ─── Illegal transitions ─────────────────────────────────────────────────
    it('rejects executing an already-EXECUTED refund', async () => {
        refundFixture = { ...refundFixture!, status: 'EXECUTED', refund_rail: 'WALLET' };
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/EXECUTED|status/i);
    });

    it('rejects executing a REJECTED refund', async () => {
        refundFixture = { ...refundFixture!, status: 'REJECTED' };
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/REJECTED|status/i);
    });

    it('rejects REQUESTED + non-WALLET rail (must go through approveRefund first)', async () => {
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({
            refundId: VALID_UUID,
            refundRail: 'WIRE_TRANSFER',
        });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/WALLET|REQUESTED|status/i);
    });

    // ─── WALLET 1-click ──────────────────────────────────────────────────────
    it('WALLET 1-click: REQUESTED + refundRail=WALLET → EXECUTED with ledger insert', async () => {
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({
            refundId: VALID_UUID,
            refundRail: 'WALLET',
        });
        expect(result).toEqual({ ok: true, refundId: VALID_UUID, rail: 'WALLET' });

        // wallet_ledger insert
        const ledgerInsert = insertCalls.find((c) => c.table === 'wallet_ledger');
        expect(ledgerInsert).toBeDefined();
        expect(ledgerInsert!.payload).toMatchObject({
            wallet_id: 'wallet-1',
            kind: 'REFUND_CREDIT',
            amount_signed_usd_minor: 100000,
            refund_id: VALID_UUID,
            created_by: 'admin-1',
        });

        // refunds UPDATE includes refund_rail=WALLET + approved_by + executed_by
        const refundUpdate = updateCalls.find((c) => c.table === 'refunds');
        expect(refundUpdate).toBeDefined();
        expect(refundUpdate!.payload).toMatchObject({
            status: 'EXECUTED',
            refund_rail: 'WALLET',
            approved_by: 'admin-1',
            executed_by: 'admin-1',
        });
        // Race-guard: id + status=REQUESTED
        const statusEq = refundUpdate!.eqColumns.find((c) => c.col === 'status');
        expect(statusEq?.val).toBe('REQUESTED');
    });

    // ─── WALLET from APPROVED ────────────────────────────────────────────────
    it('WALLET execute from APPROVED: ledger insert + UPDATE with status=APPROVED guard', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'WALLET' };
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result).toEqual({ ok: true, refundId: VALID_UUID, rail: 'WALLET' });

        const ledgerInsert = insertCalls.find((c) => c.table === 'wallet_ledger');
        expect(ledgerInsert).toBeDefined();
        expect(ledgerInsert!.payload).toMatchObject({
            wallet_id: 'wallet-1',
            kind: 'REFUND_CREDIT',
            amount_signed_usd_minor: 100000,
        });

        const refundUpdate = updateCalls.find((c) => c.table === 'refunds');
        expect(refundUpdate!.payload).toMatchObject({
            status: 'EXECUTED',
            executed_by: 'admin-1',
        });
        // Should NOT re-set refund_rail when coming from APPROVED
        expect(refundUpdate!.payload).not.toHaveProperty('refund_rail');
        const statusEq = refundUpdate!.eqColumns.find((c) => c.col === 'status');
        expect(statusEq?.val).toBe('APPROVED');
    });

    it('WALLET: returns error if wallet not found', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'WALLET' };
        walletRow = null;
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/wallet/i);
        // No ledger insert, no refund update
        expect(insertCalls.filter((c) => c.table === 'wallet_ledger')).toHaveLength(0);
        expect(updateCalls.filter((c) => c.table === 'refunds')).toHaveLength(0);
    });

    // ─── WIRE_TRANSFER ──────────────────────────────────────────────────────
    it('WIRE execute from APPROVED with proofPath: rail_details.proof_storage_path captured', async () => {
        refundFixture = {
            ...refundFixture!,
            status: 'APPROVED',
            refund_rail: 'WIRE_TRANSFER',
            rail_details: { bank_account: 'IBAN' },
        };
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({
            refundId: VALID_UUID,
            proofPath: 'wire-proofs/refund-1.pdf',
        });
        expect(result).toEqual({ ok: true, refundId: VALID_UUID, rail: 'WIRE_TRANSFER' });

        const refundUpdate = updateCalls.find((c) => c.table === 'refunds');
        expect(refundUpdate!.payload.rail_details).toMatchObject({
            bank_account: 'IBAN',
            proof_storage_path: 'wire-proofs/refund-1.pdf',
        });
        // No wallet ledger, no Stripe call
        expect(insertCalls.filter((c) => c.table === 'wallet_ledger')).toHaveLength(0);
        expect(createRefundMock).not.toHaveBeenCalled();
    });

    // ─── STRIPE ──────────────────────────────────────────────────────────────
    it('STRIPE happy path: calls stripeService.createRefund + stores stripe_refund_id', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'STRIPE' };
        createRefundMock.mockResolvedValueOnce({ id: 're_test_789', status: 'succeeded' });
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result).toEqual({ ok: true, refundId: VALID_UUID, rail: 'STRIPE' });

        expect(createRefundMock).toHaveBeenCalledWith({
            paymentIntent: 'pi_test_123',
            amountMinor: 100000,
        });

        const refundUpdate = updateCalls.find((c) => c.table === 'refunds');
        expect(refundUpdate!.payload.rail_details).toMatchObject({
            stripe_refund_id: 're_test_789',
        });
    });

    it('STRIPE: API failure leaves refund in APPROVED state, no notify, no audit', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'STRIPE' };
        createRefundMock.mockRejectedValueOnce(new Error('Stripe API down'));
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/stripe/i);

        // No refund update, no notify, no audit
        expect(updateCalls.filter((c) => c.table === 'refunds')).toHaveLength(0);
        expect(notifyOwnerMock).not.toHaveBeenCalled();
        expect(insertCalls.filter((c) => c.table === 'audit_logs')).toHaveLength(0);
    });

    it('STRIPE: returns error when original Stripe payment not found', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'STRIPE' };
        originalStripePayment = null;
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/stripe payment|original/i);
        expect(createRefundMock).not.toHaveBeenCalled();
    });

    // ─── Other rails ─────────────────────────────────────────────────────────
    it('CASH execute from APPROVED: state transition only, no side effects', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'CASH' };
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({
            refundId: VALID_UUID,
            railDetails: { justification: 'Paid at cashier' },
        });
        expect(result).toEqual({ ok: true, refundId: VALID_UUID, rail: 'CASH' });
        expect(insertCalls.filter((c) => c.table === 'wallet_ledger')).toHaveLength(0);
        expect(createRefundMock).not.toHaveBeenCalled();
        const refundUpdate = updateCalls.find((c) => c.table === 'refunds');
        expect(refundUpdate!.payload.rail_details).toMatchObject({ justification: 'Paid at cashier' });
    });

    // ─── Notification fail-soft ──────────────────────────────────────────────
    it('REFUND_ISSUED notification dispatched on happy path', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'WALLET' };
        const { executeRefund } = await import('./executeRefund');
        await executeRefund({ refundId: VALID_UUID });
        expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
        const call = notifyOwnerMock.mock.calls[0][1] as Record<string, unknown>;
        expect(call).toMatchObject({
            shipownerId: 'so-1',
            kind: 'REFUND_ISSUED',
        });
        expect((call.params as Record<string, unknown>).invoice_ref).toBe('INV-001');
        expect((call.params as Record<string, unknown>).amount_usd).toBe(1000);
        expect((call.params as Record<string, unknown>).refund_rail).toBe('WALLET');
    });

    it('notifyOwner failure does NOT roll back the EXECUTED state', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'WALLET' };
        notifyOwnerMock.mockRejectedValueOnce(new Error('notify crashed'));
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result).toEqual({ ok: true, refundId: VALID_UUID, rail: 'WALLET' });
        // Refund UPDATE + audit still happened
        expect(updateCalls.filter((c) => c.table === 'refunds')).toHaveLength(1);
        expect(insertCalls.filter((c) => c.table === 'audit_logs')).toHaveLength(1);
    });

    // ─── Audit log ───────────────────────────────────────────────────────────
    it('writes REFUND_EXECUTED audit entry with rail', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'STRIPE' };
        createRefundMock.mockResolvedValueOnce({ id: 're_test_999', status: 'succeeded' });
        const { executeRefund } = await import('./executeRefund');
        await executeRefund({ refundId: VALID_UUID });
        const audit = insertCalls.find((c) => c.table === 'audit_logs');
        expect(audit).toBeDefined();
        expect(audit!.payload).toMatchObject({
            user_id: 'admin-1',
            user_full_name: 'Admin One',
            action: 'TRANSACTION_UPDATED',
            entity_type: 'Refund',
            entity_id: VALID_UUID,
        });
        const details = audit!.payload.details_json as Record<string, unknown>;
        expect(details.event).toBe('REFUND_EXECUTED');
        expect(details.rail).toBe('STRIPE');
        expect(details.stripe_refund_id).toBe('re_test_999');
    });

    // ─── Race guard ──────────────────────────────────────────────────────────
    it('race guard: UPDATE returning 0 rows raises an error (status changed mid-flight)', async () => {
        refundFixture = { ...refundFixture!, status: 'APPROVED', refund_rail: 'WIRE_TRANSFER' };
        updatedRefundRows = [];
        const { executeRefund } = await import('./executeRefund');
        const result = await executeRefund({ refundId: VALID_UUID });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/concurrent|race|status/i);
    });
});
