'use server';

import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { getRefundById } from '@/services/refundService';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 7: rejectRefund
//
// Closes out a refund by transitioning REQUESTED|APPROVED → REJECTED with a
// mandatory justification. EXECUTED refunds cannot be rejected — once funds
// have left our books (Stripe API call placed, wallet credited, wire sent),
// reversing them is a chargeback flow that's out of scope here (deferred to
// Plan 7H).
//
// No owner notification on reject — rejecting means we don't owe them; if a
// rejection needs to be communicated, that's a separate scope.
//
// Mig 066 CHECK allows REJECTED with NULL refund_rail, so we never need to
// strip the rail (and we don't, to preserve the audit trail of what rail
// was attempted before rejection).
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
    refundId: z.string().uuid(),
    reason: z.string().min(5).max(500),
});

export async function rejectRefund(input: { refundId: string; reason: string }) {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) throw new Error('Not authorized');

    // 1. Find the refund regardless of tenant, then confine the acting admin to its
    //    jurisdiction (SUPERADMIN may act on any) and scope all writes to it.
    const platform = createPlatformClient();
    const refund = await getRefundById(platform, parsed.refundId);
    if (!refund) throw new Error(`Refund not found: ${parsed.refundId}`);
    if (refund.status !== 'REQUESTED' && refund.status !== 'APPROVED') {
        throw new Error(
            `Refund ${parsed.refundId} has status ${refund.status}; can only reject from REQUESTED or APPROVED. EXECUTED refunds require a chargeback flow.`,
        );
    }
    const admin = createTenantClient(await assertAdminCanActOn(auth.user, refund.jurisdiction_id));

    // 2. UPDATE with status-IN race guard so concurrent execute calls can't
    //    sneak through (e.g. EXECUTED + REJECTED on the same row).
    const { data: updated, error: updErr } = await admin
        .from('refunds')
        .update({
            status: 'REJECTED',
            rejection_reason: parsed.reason,
            updated_at: new Date().toISOString(),
        })
        .eq('id', parsed.refundId)
        .in('status', ['REQUESTED', 'APPROVED'])
        .select('id');
    if (updErr) throw new Error(updErr.message);
    if (!updated || (updated as unknown[]).length === 0) {
        throw new Error(
            `Refund ${parsed.refundId} status changed concurrently; refresh and retry`,
        );
    }

    // 3. Audit log
    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Refund',
        entity_id: parsed.refundId,
        jurisdiction_id: refund.jurisdiction_id,
        details_json: { event: 'REFUND_REJECTED', reason: parsed.reason },
    });

    return { ok: true, refundId: parsed.refundId };
}
