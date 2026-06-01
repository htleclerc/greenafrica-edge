'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';

const schema = z.object({ paymentId: z.string().uuid() });

export async function cancelPayment(input: { paymentId: string }) {
    const parsed = schema.parse(input);

    const ctx = await requireOwner();

    // Owner-scoped: rely on owner-bound supabase client + RLS payments_owner_cancel
    const { error } = await ctx.supabase
        .from('payments')
        .update({ status: 'CANCELLED' })
        .eq('id', parsed.paymentId)
        .eq('shipowner_id', ctx.shipowner.id)
        .eq('status', 'INITIATED')
        .select('id')
        .single();

    if (error) throw error;
    return { ok: true };
}
