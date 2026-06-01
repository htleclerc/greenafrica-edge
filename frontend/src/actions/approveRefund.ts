'use server';

import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { getRefundById } from '@/services/refundService';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 5: approveRefund
//
// Transitions a refund row from REQUESTED → APPROVED, capturing the chosen
// refund rail + rail-specific details + approver identity. The actual
// execution (wallet credit, Stripe API call, etc.) happens in executeRefund.
//
// Note: for the WALLET rail, the UI is expected to skip this action and call
// executeRefund directly (1-click execute combo). This action is the path
// for WIRE/STRIPE/other rails that need a 2-step approve→execute workflow.
//
// Mig 066 CHECK constraint: `status = 'REQUESTED' OR refund_rail IS NOT NULL`.
// Setting refund_rail in the same UPDATE that transitions to APPROVED keeps
// us in a valid state at every commit boundary.
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
    refundId: z.string().uuid(),
    refundRail: z.enum([
        'WALLET',
        'WIRE_TRANSFER',
        'STRIPE',
        'CASH',
        'CHEQUE',
        'MOBILE_MONEY',
        'THIRD_PARTY',
        'BANK_GUARANTEE',
        'NETTING',
        'LETTER_OF_CREDIT',
    ]),
    railDetails: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function approveRefund(input: {
    refundId: string;
    refundRail:
        | 'WALLET'
        | 'WIRE_TRANSFER'
        | 'STRIPE'
        | 'CASH'
        | 'CHEQUE'
        | 'MOBILE_MONEY'
        | 'THIRD_PARTY'
        | 'BANK_GUARANTEE'
        | 'NETTING'
        | 'LETTER_OF_CREDIT';
    railDetails?: Record<string, unknown>;
}) {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) throw new Error('Not authorized');

    // 1. Find the refund regardless of tenant, then confine the acting admin to its
    //    jurisdiction (SUPERADMIN may act on any) and scope all writes to it.
    const platform = createPlatformClient();
    const refund = await getRefundById(platform, parsed.refundId);
    if (!refund) throw new Error(`Refund not found: ${parsed.refundId}`);
    if (refund.status !== 'REQUESTED') {
        throw new Error(
            `Refund ${parsed.refundId} has status ${refund.status}; can only approve from REQUESTED`,
        );
    }
    const admin = createTenantClient(await assertAdminCanActOn(auth.user, refund.jurisdiction_id));

    // 2. UPDATE with status='REQUESTED' race guard so concurrent approve/reject
    //    calls can't both succeed.
    const { data: updated, error: updErr } = await admin
        .from('refunds')
        .update({
            status: 'APPROVED',
            refund_rail: parsed.refundRail,
            rail_details: parsed.railDetails,
            approved_by: auth.user.id,
            updated_at: new Date().toISOString(),
        })
        .eq('id', parsed.refundId)
        .eq('status', 'REQUESTED')
        .select('id');
    if (updErr) throw new Error(updErr.message);
    if (!updated || (updated as unknown[]).length === 0) {
        throw new Error(
            `Refund ${parsed.refundId} status changed concurrently; refresh and retry`,
        );
    }

    // 3. Audit log — mirror the Plan 7C-1 payment audit shape.
    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Refund',
        entity_id: parsed.refundId,
        details_json: { event: 'REFUND_APPROVED', rail: parsed.refundRail },
    });

    return { ok: true, refundId: parsed.refundId };
}
