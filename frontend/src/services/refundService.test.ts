import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    listRefundsForAdmin,
    getRefundById,
    listRefundsForOwner,
} from './refundService';

/**
 * Chainable mock for the Supabase client.
 *
 * The refundService calls one of three shapes per function:
 *   listRefundsForAdmin: .from(refunds).select(*, joins).[eq(status)?].order().range()
 *   getRefundById:        .from(refunds).select(*, joins).eq(id).maybeSingle()
 *   listRefundsForOwner:  .from(refunds).select().eq(shipowner_id).order()
 *
 * The mock returns a single object with all the relevant chainable methods
 * mocked to no-ops that ultimately resolve to the configured data.
 */
function makeClient(opts: {
    adminRefunds?: Array<Record<string, unknown>>;
    singleRefund?: Record<string, unknown> | null;
    ownerRefunds?: Array<Record<string, unknown>>;
    captureLastFilters?: { status?: unknown; shipowner_id?: unknown; id?: unknown };
} = {}) {
    const filters = opts.captureLastFilters ?? {};

    function adminChain(): Record<string, unknown> {
        // Supports both:
        //   listRefundsForAdmin: select → [eq(status)?] → order → range
        //   getRefundById:       select → eq(id) → maybeSingle
        //   listRefundsForOwner: select → eq(shipowner_id) → order (resolves directly)
        return {
            eq: vi.fn((col: string, val: unknown) => {
                (filters as Record<string, unknown>)[col] = val;
                return adminChain();
            }),
            // order() supports both shapes: returns thenable resolving to data
            // (for owner list) AND exposes .range() (for admin list).
            order: vi.fn(() => {
                const result = { data: opts.adminRefunds ?? [], error: null };
                return {
                    range: vi.fn().mockResolvedValue(result),
                    then: (onFulfilled: (v: typeof result) => unknown) => Promise.resolve(result).then(onFulfilled),
                };
            }),
            maybeSingle: vi.fn().mockResolvedValue({ data: opts.singleRefund ?? null, error: null }),
        };
    }

    return {
        from: vi.fn((_table: string) => ({
            select: vi.fn(() => adminChain()),
        })),
    } as unknown as SupabaseClient;
}

describe('listRefundsForAdmin', () => {
    it('returns rows with embedded transaction + shipowner refs', async () => {
        const client = makeClient({
            adminRefunds: [
                {
                    id: 'r1',
                    transaction_id: 't1',
                    shipowner_id: 'o1',
                    amount_usd_minor: 50000,
                    refund_rail: null,
                    rail_details: {},
                    status: 'REQUESTED',
                    requested_by: null,
                    approved_by: null,
                    executed_by: null,
                    executed_at: null,
                    rejection_reason: null,
                    created_at: '2026-05-12T00:00:00Z',
                    updated_at: '2026-05-12T00:00:00Z',
                    transaction: { invoice_ref: 'INV-1', vessel_name: 'M/V Test', document_type: 'REFUND', tax_amount_usd: 500 },
                    shipowner: { name: 'Acme Shipping', official_email: 'acme@test' },
                },
            ],
        });
        const rows = await listRefundsForAdmin(client, {});
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('r1');
        expect(rows[0].transaction?.invoice_ref).toBe('INV-1');
        expect(rows[0].shipowner?.name).toBe('Acme Shipping');
    });

    it('filters by status when provided', async () => {
        const captured: Record<string, unknown> = {};
        const client = makeClient({ adminRefunds: [], captureLastFilters: captured });
        await listRefundsForAdmin(client, { status: 'REQUESTED' });
        expect(captured.status).toBe('REQUESTED');
    });

    it('returns all rows when no status filter is given', async () => {
        const captured: Record<string, unknown> = {};
        const client = makeClient({
            adminRefunds: [
                { id: 'r1', status: 'REQUESTED' },
                { id: 'r2', status: 'EXECUTED' },
            ],
            captureLastFilters: captured,
        });
        const rows = await listRefundsForAdmin(client, {});
        expect(rows).toHaveLength(2);
        expect(captured.status).toBeUndefined();
    });
});

describe('getRefundById', () => {
    it('returns null when not found', async () => {
        const client = makeClient({ singleRefund: null });
        const r = await getRefundById(client, 'r-missing');
        expect(r).toBeNull();
    });

    it('returns hydrated refund row when found', async () => {
        const client = makeClient({
            singleRefund: {
                id: 'r1',
                transaction_id: 't1',
                shipowner_id: 'o1',
                amount_usd_minor: 50000,
                status: 'APPROVED',
                transaction: { invoice_ref: 'INV-1', vessel_name: null, document_type: 'REFUND', tax_amount_usd: 500 },
                shipowner: { name: 'Acme', official_email: null },
            },
        });
        const r = await getRefundById(client, 'r1');
        expect(r?.id).toBe('r1');
        expect(r?.status).toBe('APPROVED');
    });
});

describe('listRefundsForOwner', () => {
    it('scopes by shipowner_id', async () => {
        const captured: Record<string, unknown> = {};
        const client = makeClient({
            adminRefunds: [
                { id: 'r1', shipowner_id: 'own-1', status: 'REQUESTED' },
            ],
            captureLastFilters: captured,
        });
        const rows = await listRefundsForOwner(client, 'own-1');
        expect(captured.shipowner_id).toBe('own-1');
        expect(rows).toHaveLength(1);
    });
});
