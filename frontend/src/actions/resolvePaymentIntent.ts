'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';

const schema = z.object({
    intentId: z.string().uuid(),
    action: z.enum(['confirm', 'reject']),
    resolutionNote: z.string().trim().max(500).optional().default(''),
});

const ALLOWED_ROLES = ['SUPERADMIN', 'FINANCE_ADMIN'] as const;

export type ResolvePaymentIntentResult =
    | { ok: true; transactionPaid: boolean }
    | { ok: false; reason: string };

/**
 * FINANCE_ADMIN / SUPERADMIN handles a pending shipowner_payment_intent.
 *
 * - 'confirm': updates the intent to CONFIRMED and flips the underlying
 *   transaction to PAID (status='PAID' + collections_status='PAID' to satisfy
 *   the mig 022 invariant + paid_at = now). Vessel compliance is also flipped
 *   to COMPLIANT and tax_liability_usd zeroed, mirroring mark-paid's effect.
 *   Receipt PDF generation + email notification are NOT done here — admins
 *   who need those go through /api/transactions/mark-paid manually for now.
 *
 * - 'reject': updates the intent to REJECTED with the resolution_note,
 *   leaves the transaction untouched.
 *
 * RLS policies on shipowner_payment_intents (mig 039) gate UPDATE to
 * FINANCE_ADMIN/SUPERADMIN, but the transaction + vessel updates need the
 * service role since RLS scopes them to the owner.
 */
export async function resolvePaymentIntent(
    raw: unknown,
): Promise<ResolvePaymentIntentResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return { ok: false, reason: 'service role not configured' };
    }
    const admin = createServiceRole(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
    });

    // Load the intent so we can act on its transaction_id
    const { data: intent, error: intentErr } = await admin
        .from('shipowner_payment_intents')
        .select('id, transaction_id, status, amount_usd')
        .eq('id', parsed.data.intentId)
        .single();
    if (intentErr || !intent) {
        return { ok: false, reason: 'payment intent not found' };
    }
    if (intent.status !== 'DECLARED') {
        return { ok: false, reason: `intent already ${intent.status.toLowerCase()}` };
    }

    const now = new Date().toISOString();

    if (parsed.data.action === 'reject') {
        const { error } = await admin
            .from('shipowner_payment_intents')
            .update({
                status: 'REJECTED',
                resolved_by: auth.user.id,
                resolved_at: now,
                resolution_note: parsed.data.resolutionNote || null,
            })
            .eq('id', intent.id);
        if (error) return { ok: false, reason: error.message };
        return { ok: true, transactionPaid: false };
    }

    // ── confirm path ────────────────────────────────────────────────────
    // 1. Flip the intent
    const { error: intentUpdateErr } = await admin
        .from('shipowner_payment_intents')
        .update({
            status: 'CONFIRMED',
            resolved_by: auth.user.id,
            resolved_at: now,
            resolution_note: parsed.data.resolutionNote || null,
        })
        .eq('id', intent.id);
    if (intentUpdateErr) return { ok: false, reason: intentUpdateErr.message };

    // 2. Mark the transaction PAID. collections_status='PAID' is required
    //    by the mig 022 invariant trigger.
    const { data: txn, error: txnErr } = await admin
        .from('transactions')
        .update({
            status: 'PAID',
            collections_status: 'PAID',
            paid_at: now,
        })
        .eq('id', intent.transaction_id)
        .select('vessel_id, vessel_name, tax_amount_usd')
        .single();
    if (txnErr || !txn) {
        return {
            ok: false,
            reason: `intent confirmed but transaction update failed: ${txnErr?.message ?? 'unknown'}`,
        };
    }

    // 3. Vessel compliance — best-effort, mirror mark-paid behaviour
    if (txn.vessel_id) {
        await admin
            .from('vessels')
            .update({ compliance_status: 'COMPLIANT', tax_liability_usd: 0 })
            .eq('id', txn.vessel_id);
    }

    // 4. Audit log
    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? 'Finance Admin',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Transaction',
        entity_id: intent.transaction_id,
        details_json: {
            event: 'PAYMENT_INTENT_CONFIRMED',
            intentId: intent.id,
            amountUsd: Number(intent.amount_usd),
            currency: 'USD',
            previousStatus: 'PENDING',
            newStatus: 'PAID',
            paidAt: now,
            resolutionNote: parsed.data.resolutionNote || null,
        },
    });

    return { ok: true, transactionPaid: true };
}
