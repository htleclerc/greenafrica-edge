'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';

const schema = z.object({ notificationId: z.string().uuid() });

export async function markNotificationRead(input: { notificationId: string }): Promise<void> {
    const parsed = schema.parse(input);
    const ctx = await requireOwner();

    // Service-role via the tenant-scoped factory: auto-filters by jurisdiction_id
    // (defense in depth) on top of the explicit shipowner_id scope below.
    const admin = createTenantClient(ctx.jurisdictionId);

    // Scope to the owner's notifications only — prevents cross-owner mark-read
    // even if a malicious caller forges a notificationId.
    const { error } = await admin
        .from('owner_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', parsed.notificationId)
        .eq('shipowner_id', ctx.shipowner.id);

    if (error) throw new Error(error.message);
}
