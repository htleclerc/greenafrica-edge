import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentRail } from '@/services/paymentService';

/**
 * Refund row from `public.refunds` (mig 052 + mig 066 nullable refund_rail).
 *
 * Lifecycle: REQUESTED → APPROVED → EXECUTED, or REQUESTED|APPROVED → REJECTED.
 * Per mig 066's CHECK: status = 'REQUESTED' or refund_rail IS NOT NULL.
 */
export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'EXECUTED' | 'REJECTED';

export interface RefundRow {
    id: string;
    transaction_id: string;
    shipowner_id: string;
    jurisdiction_id: string;
    amount_usd_minor: number;
    refund_rail: PaymentRail | null;
    rail_details: Record<string, unknown>;
    status: RefundStatus;
    requested_by: string | null;
    approved_by: string | null;
    executed_by: string | null;
    executed_at: string | null;
    rejection_reason: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * Refund with embedded transaction and shipowner references for admin
 * list/detail views. Joined via PostgREST.
 */
export interface RefundWithRefs extends RefundRow {
    transaction: {
        invoice_ref: string;
        vessel_name: string | null;
        document_type: string;
        tax_amount_usd: number;
    } | null;
    shipowner: {
        name: string;
        official_email: string | null;
    } | null;
}

const ADMIN_SELECT =
    '*, transaction:transactions(invoice_ref,vessel_name,document_type,tax_amount_usd), shipowner:shipowners(name,official_email)';

export interface ListRefundsForAdminFilters {
    status?: RefundStatus;
    offset?: number;
    limit?: number;
}

/**
 * List refunds for the admin arbitration view, newest first, paginated.
 * Call sites MUST pass a service-role client (mig 052 RLS-with-zero-policies
 * gap — same pattern as wallets/notifications). Auth/role gating happens at
 * the action/page layer.
 */
export async function listRefundsForAdmin(
    client: SupabaseClient,
    filters: ListRefundsForAdminFilters,
): Promise<RefundWithRefs[]> {
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;

    let q = client.from('refunds').select(ADMIN_SELECT) as unknown as {
        eq: (col: string, val: unknown) => typeof q;
        order: (col: string, opts: { ascending: boolean }) => {
            range: (from: number, to: number) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
    };
    if (filters.status) {
        q = q.eq('status', filters.status);
    }
    const { data, error } = await q
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return (data ?? []) as RefundWithRefs[];
}

/**
 * Fetch a single refund by id with joined transaction + shipowner.
 * Returns null if not found.
 */
export async function getRefundById(
    client: SupabaseClient,
    refundId: string,
): Promise<RefundWithRefs | null> {
    const { data, error } = await client
        .from('refunds')
        .select(ADMIN_SELECT)
        .eq('id', refundId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as RefundWithRefs | null;
}

/**
 * List refunds for a single shipowner (owner-facing, no joins needed —
 * the owner already has the invoice context in their portal).
 */
export async function listRefundsForOwner(
    client: SupabaseClient,
    shipownerId: string,
): Promise<RefundRow[]> {
    const { data, error } = await client
        .from('refunds')
        .select('*')
        .eq('shipowner_id', shipownerId)
        .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RefundRow[];
}
