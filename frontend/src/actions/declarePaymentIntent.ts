'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({
    transactionId: z.string().uuid(),
    reference: z.string().trim().min(3).max(120),
    amountUsd: z.number().positive().finite(),
    notes: z.string().trim().max(500).optional().default(''),
});

export type DeclarePaymentIntentResult =
    | { ok: true; intentId: string }
    | { ok: false; reason: string };

/**
 * Owner-side payment declaration. Records that the owner has paid the
 * pro-forma identified by transactionId via the bank reference they
 * provide. Status is DECLARED — FINANCE_ADMIN later moves it to CONFIRMED
 * (via the existing mark-paid flow) or REJECTED.
 *
 * RLS on shipowner_payment_intents (mig 039) enforces:
 *   - declared_by = auth.uid() (set in INSERT)
 *   - the transaction belongs to the user via shipowners.profile_id
 * So this action does NOT need a service-role client — the user's own
 * session has exactly the rights it needs and nothing more.
 */
export async function declarePaymentIntent(
    raw: unknown,
): Promise<DeclarePaymentIntentResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    // Defence-in-depth — RLS will enforce the same check, but a direct
    // query keeps the failure mode obvious if the policy is ever weakened.
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (profile?.role !== 'SHIPOWNER') {
        return { ok: false, reason: 'only shipowners can declare payments' };
    }

    const { data: intent, error } = await supabase
        .from('shipowner_payment_intents')
        .insert({
            transaction_id: parsed.data.transactionId,
            declared_by: auth.user.id,
            reference: parsed.data.reference,
            amount_usd: parsed.data.amountUsd,
            notes: parsed.data.notes || null,
            status: 'DECLARED',
        })
        .select('id')
        .single();

    if (error) {
        return { ok: false, reason: error.message };
    }

    return { ok: true, intentId: intent.id };
}
