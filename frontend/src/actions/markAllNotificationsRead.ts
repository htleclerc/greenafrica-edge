'use server';

import { createClient } from '@supabase/supabase-js';
import { requireOwner } from '@/lib/auth/requireOwner';

export async function markAllNotificationsRead(): Promise<{ count: number }> {
    const ctx = await requireOwner();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

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
