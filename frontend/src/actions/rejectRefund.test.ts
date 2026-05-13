import { describe, it, expect, vi, beforeEach } from 'vitest';

interface UpdateCall {
    payload: Record<string, unknown>;
    eqColumns: { col: string; val: unknown }[];
    inColumns: { col: string; vals: unknown[] }[];
}

let refundRow: Record<string, unknown> | null = {
    id: 'refund-1',
    status: 'REQUESTED',
    transaction_id: 'tx-1',
    shipowner_id: 'so-1',
    amount_usd_minor: 100000,
    refund_rail: null,
    rail_details: {},
};
let updatedRows: Record<string, unknown>[] = [{ id: 'refund-1' }];
const updateCalls: UpdateCall[] = [];
const auditCalls: Record<string, unknown>[] = [];
let requireRoleResult: { user: { id: string; fullName: string } | null; supabase: unknown; error: unknown } = {
    user: { id: 'admin-1', fullName: 'Admin One' },
    supabase: null,
    error: null,
};

const mockSupabase = {
    from: vi.fn((table: string) => {
        if (table === 'refunds') {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: refundRow, error: null }),
                    }),
                }),
                update: (payload: Record<string, unknown>) => {
                    const call: UpdateCall = { payload, eqColumns: [], inColumns: [] };
                    updateCalls.push(call);
                    const builder: any = {
                        eq: (col: string, val: unknown) => {
                            call.eqColumns.push({ col, val });
                            return builder;
                        },
                        in: (col: string, vals: unknown[]) => {
                            call.inColumns.push({ col, vals });
                            return builder;
                        },
                        select: () => Promise.resolve({ data: updatedRows, error: null }),
                    };
                    return builder;
                },
            };
        }
        if (table === 'audit_logs') {
            return {
                insert: async (row: Record<string, unknown>) => {
                    auditCalls.push(row);
                    return { error: null };
                },
            };
        }
        return {} as never;
    }),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => requireRoleResult),
}));

beforeEach(() => {
    refundRow = {
        id: 'refund-1',
        status: 'REQUESTED',
        transaction_id: 'tx-1',
        shipowner_id: 'so-1',
        amount_usd_minor: 100000,
        refund_rail: null,
        rail_details: {},
    };
    updatedRows = [{ id: 'refund-1' }];
    updateCalls.length = 0;
    auditCalls.length = 0;
    requireRoleResult = {
        user: { id: 'admin-1', fullName: 'Admin One' },
        supabase: null,
        error: null,
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    vi.clearAllMocks();
});

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('rejectRefund', () => {
    it('enforces minimum reason length (5 chars)', async () => {
        const { rejectRefund } = await import('./rejectRefund');
        await expect(rejectRefund({ refundId: VALID_UUID, reason: 'oops' }))
            .rejects.toThrow();
    });

    it('enforces maximum reason length (500 chars)', async () => {
        const { rejectRefund } = await import('./rejectRefund');
        const tooLong = 'x'.repeat(501);
        await expect(rejectRefund({ refundId: VALID_UUID, reason: tooLong }))
            .rejects.toThrow();
    });

    it('rejects callers without FINANCE_ADMIN or SUPERADMIN role', async () => {
        requireRoleResult = { user: null, supabase: null, error: { status: 403 } };
        const { rejectRefund } = await import('./rejectRefund');
        await expect(rejectRefund({ refundId: VALID_UUID, reason: 'No proof attached' }))
            .rejects.toThrow(/not authorized/i);
    });

    it('rejects when refund does not exist', async () => {
        refundRow = null;
        const { rejectRefund } = await import('./rejectRefund');
        await expect(rejectRefund({ refundId: VALID_UUID, reason: 'No proof attached' }))
            .rejects.toThrow(/not found/i);
    });

    it('rejects an EXECUTED refund (cannot reverse — chargeback flow out of scope)', async () => {
        refundRow = {
            ...refundRow!,
            status: 'EXECUTED',
            refund_rail: 'WALLET',
        };
        const { rejectRefund } = await import('./rejectRefund');
        await expect(rejectRefund({ refundId: VALID_UUID, reason: 'No proof attached' }))
            .rejects.toThrow(/EXECUTED|status/i);
    });

    it('happy path REQUESTED → REJECTED with reason captured', async () => {
        const { rejectRefund } = await import('./rejectRefund');
        const result = await rejectRefund({ refundId: VALID_UUID, reason: 'Duplicate request' });
        expect(result).toEqual({ ok: true, refundId: VALID_UUID });
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0].payload).toMatchObject({
            status: 'REJECTED',
            rejection_reason: 'Duplicate request',
        });
        // Race-guard: status must be in ('REQUESTED','APPROVED')
        expect(updateCalls[0].inColumns).toHaveLength(1);
        expect(updateCalls[0].inColumns[0].col).toBe('status');
        expect(updateCalls[0].inColumns[0].vals).toEqual(['REQUESTED', 'APPROVED']);
    });

    it('happy path APPROVED → REJECTED preserves the previously set refund_rail', async () => {
        refundRow = {
            ...refundRow!,
            status: 'APPROVED',
            refund_rail: 'WIRE_TRANSFER',
        };
        const { rejectRefund } = await import('./rejectRefund');
        await rejectRefund({ refundId: VALID_UUID, reason: 'Bank refused transfer' });
        expect(updateCalls).toHaveLength(1);
        // Must NOT clear refund_rail (mig 066 CHECK still allows REJECTED+rail set)
        expect(updateCalls[0].payload).not.toHaveProperty('refund_rail');
    });

    it('writes an audit log REFUND_REJECTED entry with reason', async () => {
        const { rejectRefund } = await import('./rejectRefund');
        await rejectRefund({ refundId: VALID_UUID, reason: 'Owner withdrew claim' });
        expect(auditCalls).toHaveLength(1);
        expect(auditCalls[0]).toMatchObject({
            user_id: 'admin-1',
            user_full_name: 'Admin One',
            action: 'TRANSACTION_UPDATED',
            severity: 'INFO',
            entity_type: 'Refund',
            entity_id: VALID_UUID,
            details_json: { event: 'REFUND_REJECTED', reason: 'Owner withdrew claim' },
        });
    });

    it('race guard: UPDATE returning 0 rows raises an error', async () => {
        updatedRows = [];
        const { rejectRefund } = await import('./rejectRefund');
        await expect(rejectRefund({ refundId: VALID_UUID, reason: 'Duplicate request' }))
            .rejects.toThrow(/race|concurrent|status/i);
    });
});
