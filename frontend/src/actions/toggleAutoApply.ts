'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';

const schema = z.object({ enabled: z.boolean() });

export async function toggleAutoApply(input: { enabled: boolean }): Promise<void> {
    const parsed = schema.parse(input);
    const ctx = await requireOwner();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const { error } = await admin
        .from('wallets')
        .update({ auto_apply_to_proforma: parsed.enabled })
        .eq('shipowner_id', ctx.shipowner.id);

    if (error) throw new Error(error.message);
}
