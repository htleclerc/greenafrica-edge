import { describe, it, expect, vi, beforeEach } from 'vitest';

interface UpdateCall {
    payload: Record<string, unknown>;
    eqColumns: { col: string; val: unknown }[];
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
let requireRoleResult: { user: { id: string; fullName: string; role: string } | null; supabase: unknown; error: unknown } = {
    user: { id: 'admin-1', fullName: 'Admin One', role: 'SUPERADMIN' },
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
                    const call: UpdateCall = { payload, eqColumns: [] };
                    updateCalls.push(call);
                    const builder: any = {
                        eq: (col: string, val: unknown) => {
                            call.eqColumns.push({ col, val });
                            return builder;
                        },
                        select: () => ({
                            // After both eq calls, return updated rows
                            then: undefined,
                        }),
                    };
                    // Final chain: .update().eq().eq().select() must return a promise
                    builder.select = () => Promise.resolve({ data: updatedRows, error: null });
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

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockSupabase),
    createTenantClient: vi.fn(() => mockSupabase),
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
        user: { id: 'admin-1', fullName: 'Admin One', role: 'SUPERADMIN' },
        supabase: null,
        error: null,
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    vi.clearAllMocks();
});

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('approveRefund', () => {
    it('rejects non-uuid refundId', async () => {
        const { approveRefund } = await import('./approveRefund');
        await expect(approveRefund({ refundId: 'not-a-uuid', refundRail: 'WIRE_TRANSFER' }))
            .rejects.toThrow();
    });

    it('rejects unknown refund rail', async () => {
        const { approveRefund } = await import('./approveRefund');
        await expect(
            approveRefund({ refundId: VALID_UUID, refundRail: 'CRYPTO' as never }),
        ).rejects.toThrow();
    });

    it('rejects callers without FINANCE_ADMIN or SUPERADMIN role', async () => {
        requireRoleResult = { user: null, supabase: null, error: { status: 403 } };
        const { approveRefund } = await import('./approveRefund');
        await expect(approveRefund({ refundId: VALID_UUID, refundRail: 'WIRE_TRANSFER' }))
            .rejects.toThrow(/not authorized/i);
    });

    it('rejects when refund is not in REQUESTED status', async () => {
        refundRow = { ...refundRow!, status: 'APPROVED' };
        const { approveRefund } = await import('./approveRefund');
        await expect(approveRefund({ refundId: VALID_UUID, refundRail: 'WIRE_TRANSFER' }))
            .rejects.toThrow(/status/i);
    });

    it('rejects when refund does not exist', async () => {
        refundRow = null;
        const { approveRefund } = await import('./approveRefund');
        await expect(approveRefund({ refundId: VALID_UUID, refundRail: 'WIRE_TRANSFER' }))
            .rejects.toThrow(/not found/i);
    });

    it('happy path: transitions REQUESTED → APPROVED with rail + approved_by', async () => {
        const { approveRefund } = await import('./approveRefund');
        const result = await approveRefund({
            refundId: VALID_UUID,
            refundRail: 'WIRE_TRANSFER',
            railDetails: { bank_account: 'IBAN_REDACTED' },
        });
        expect(result).toEqual({ ok: true, refundId: VALID_UUID });
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0].payload).toMatchObject({
            status: 'APPROVED',
            refund_rail: 'WIRE_TRANSFER',
            rail_details: { bank_account: 'IBAN_REDACTED' },
            approved_by: 'admin-1',
        });
        // Race-guard: should filter on id AND status=REQUESTED
        const ids = updateCalls[0].eqColumns.map((c) => c.col);
        expect(ids).toContain('id');
        expect(ids).toContain('status');
        const statusEq = updateCalls[0].eqColumns.find((c) => c.col === 'status');
        expect(statusEq?.val).toBe('REQUESTED');
    });

    it('writes an audit log REFUND_APPROVED entry with rail', async () => {
        const { approveRefund } = await import('./approveRefund');
        await approveRefund({ refundId: VALID_UUID, refundRail: 'STRIPE' });
        expect(auditCalls).toHaveLength(1);
        expect(auditCalls[0]).toMatchObject({
            user_id: 'admin-1',
            user_full_name: 'Admin One',
            action: 'TRANSACTION_UPDATED',
            severity: 'INFO',
            entity_type: 'Refund',
            entity_id: VALID_UUID,
            details_json: { event: 'REFUND_APPROVED', rail: 'STRIPE' },
        });
    });

    it('race guard: UPDATE returning 0 rows raises an error', async () => {
        updatedRows = []; // simulate concurrent transition consumed the REQUESTED row
        const { approveRefund } = await import('./approveRefund');
        await expect(approveRefund({ refundId: VALID_UUID, refundRail: 'WALLET' }))
            .rejects.toThrow(/race|concurrent|status/i);
    });

    it('defaults railDetails to empty object when omitted', async () => {
        const { approveRefund } = await import('./approveRefund');
        await approveRefund({ refundId: VALID_UUID, refundRail: 'CASH' });
        expect(updateCalls[0].payload.rail_details).toEqual({});
    });
});
