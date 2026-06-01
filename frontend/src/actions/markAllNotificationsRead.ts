'use server';

import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';

export async function markAllNotificationsRead(): Promise<{ count: number }> {
    const ctx = await requireOwner();

    const admin = createTenantClient(ctx.jurisdictionId);

    // count: 'exact' lets us return how many rows were flipped so the UI can
    // surface a "marked N as read" toast.
    const { error, count } = await admin
        .from('owner_notifications')
        .update({ read_at: new Date().toISOString() }, { count: 'exact' })
        .eq('shipowner_id', ctx.shipowner.id)
        .is('read_at', null);

    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
}
