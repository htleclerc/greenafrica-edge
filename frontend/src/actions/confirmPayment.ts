'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const schema = z.object({ paymentId: z.string().uuid() });

export async function confirmPayment(input: { paymentId: string }) {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) throw new Error('Not authorized');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const { data: ok, error: gateErr } = await admin.rpc('can_confirm_payment', {
        p_payment_id: parsed.paymentId,
        p_profile_id: auth.user.id,
    });
    if (gateErr) throw gateErr;
    if (!ok) throw new Error('Not authorized to confirm this payment');

    const confirmedAt = new Date().toISOString();
    const { data: updated, error: updErr } = await admin
        .from('payments')
        .update({ status: 'CONFIRMED', confirmed_by: auth.user.id, confirmed_at: confirmedAt })
        .eq('id', parsed.paymentId)
        .select('id, transaction_id')
        .single();
    if (updErr) throw updErr;

    if (updated.transaction_id) {
        await admin.rpc('recompute_transaction_status', { p_transaction_id: updated.transaction_id });
    }

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Payment',
        entity_id: parsed.paymentId,
        details_json: { event: 'PAYMENT_CONFIRMED', confirmed_at: confirmedAt },
    });

    return { ok: true, paymentId: parsed.paymentId };
}
