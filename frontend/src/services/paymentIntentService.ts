// ─────────────────────────────────────────────────────────────────────────────
// Payment intents — admin-side read helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// Reads from shipowner_payment_intents (mig 039) joined with the transaction
// + shipowner names so the admin panel doesn't need a second roundtrip.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';

export type PaymentIntentStatus = 'DECLARED' | 'CONFIRMED' | 'REJECTED';

export interface PaymentIntentRow {
    id: string;
    transaction_id: string;
    declared_by: string;
    reference: string;
    amount_usd: number;
    notes: string | null;
    status: PaymentIntentStatus;
    declared_at: string;
    resolved_at: string | null;
    resolved_by: string | null;
    resolution_note: string | null;
    txn: {
        id: string;
        invoice_ref: string | null;
        document_type: string | null;
        vessel_name: string;
        tax_amount_usd: number;
        status: string;
        shipowner_id: string | null;
    } | null;
    declarer: {
        full_name: string | null;
        email: string;
    } | null;
}

/**
 * List intents in DECLARED status — the admin queue. Joined with the
 * underlying transaction so the panel can show invoice ref, vessel,
 * declared amount vs invoice amount (so admin can spot mismatches).
 */
export async function listPendingPaymentIntents(
    db: SupabaseClient,
): Promise<PaymentIntentRow[]> {
    const { data, error } = await db
        .from('shipowner_payment_intents')
        .select(
            `id, transaction_id, declared_by, reference, amount_usd, notes,
             status, declared_at, resolved_at, resolved_by, resolution_note,
             txn:transactions (id, invoice_ref, document_type, vessel_name, tax_amount_usd, status, shipowner_id),
             declarer:profiles!declared_by (full_name, email)`,
        )
        .eq('status', 'DECLARED')
        .order('declared_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as unknown as PaymentIntentRow[];
}
