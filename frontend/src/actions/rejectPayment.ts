'use server';

import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { scopedLogger } from '@/lib/logger';
import { UserRole } from '@/types/secure';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';

const log = scopedLogger('rejectPayment');

const schema = z.object({
    paymentId: z.string().uuid(),
    reason: z.string().min(3).max(500),
});

export async function rejectPayment(input: { paymentId: string; reason: string }) {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) throw new Error('Not authorized');

    log.info('action_invoked', {
        paymentId: parsed.paymentId,
        userId: auth.user.id,
        reasonLen: parsed.reason.length,
    });

    // Resolve the payment's jurisdiction (find regardless of tenant), confine the
    // acting admin to it (SUPERADMIN may act on any), and scope all writes to it.
    const platform = createPlatformClient();
    const { data: pmtRow, error: pmtErr } = await platform
        .from('payments')
        .select('jurisdiction_id')
        .eq('id', parsed.paymentId)
        .maybeSingle();
    if (pmtErr) throw pmtErr;
    if (!pmtRow) throw new Error(`Payment not found: ${parsed.paymentId}`);
    const admin = createTenantClient(
        await assertAdminCanActOn(auth.user, (pmtRow as { jurisdiction_id: string }).jurisdiction_id),
    );

    const { data: ok, error: gateErr } = await admin.rpc('can_confirm_payment', {
        p_payment_id: parsed.paymentId,
        p_profile_id: auth.user.id,
    });
    if (gateErr) throw gateErr;
    if (!ok) throw new Error('Not authorized to reject this payment');

    const { data: updated, error: updErr } = await admin
        .from('payments')
        .update({ status: 'REJECTED', rejected_reason: parsed.reason })
        .eq('id', parsed.paymentId)
        .select('id, shipowner_id, transaction_id')
        .single();
    if (updErr) throw updErr;

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Payment',
        entity_id: parsed.paymentId,
        details_json: { event: 'PAYMENT_REJECTED', reason: parsed.reason },
    });

    log.info('payment_rejected', {
        paymentId: parsed.paymentId,
        transactionId: (updated as { transaction_id?: string | null } | null)?.transaction_id ?? null,
        shipownerId: (updated as { shipowner_id?: string } | null)?.shipowner_id ?? null,
    });

    // Plan 7F: in-app notification + rejection email (fail-soft)
    try {
        const shipownerId = (updated as { shipowner_id?: string } | null)?.shipowner_id;
        const transactionId = (updated as { transaction_id?: string | null } | null)?.transaction_id;
        if (shipownerId) {
            let invoiceRef: string | null = null;
            if (transactionId) {
                const { data: tx } = await admin
                    .from('transactions')
                    .select('invoice_ref')
                    .eq('id', transactionId)
                    .single();
                invoiceRef = (tx as { invoice_ref?: string | null } | null)?.invoice_ref ?? null;
            }
            const { notifyOwner } = await import('@/services/notificationService');
            await notifyOwner(admin, {
                shipownerId,
                kind: 'PAYMENT_REJECTED',
                params: {
                    invoice_ref: invoiceRef ?? '—',
                    reason: parsed.reason,
                },
                deepLink: `/owner/invoices?ref=${encodeURIComponent(invoiceRef ?? '')}`,
            });
        }
    } catch (notifyErr) {
        log.warn('notification_dispatch_failed', {
            paymentId: parsed.paymentId,
            error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        });
    }

    return { ok: true };
}
