'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';

const schema = z.object({ notificationId: z.string().uuid() });

export async function markNotificationRead(input: { notificationId: string }): Promise<void> {
    const parsed = schema.parse(input);
    const ctx = await requireOwner();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    // Scope to the owner's notifications only — prevents cross-owner mark-read
    // even if a malicious caller forges a notificationId.
    const { error } = await admin
        .from('owner_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', parsed.notificationId)
        .eq('shipowner_id', ctx.shipowner.id);

    if (error) throw new Error(error.message);
}
