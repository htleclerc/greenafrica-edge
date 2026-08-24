'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';

const schema = z.object({ enabled: z.boolean() });

export async function toggleAutoApply(input: { enabled: boolean }): Promise<void> {
    const parsed = schema.parse(input);
    const ctx = await requireOwner('canPay');

    const admin = createTenantClient(ctx.jurisdictionId);

    // UPSERT (not UPDATE) — a fresh shipowner with no ledger entries yet won't have
    // a wallet row, so plain UPDATE silently no-ops. wallets.shipowner_id is UNIQUE
    // (mig 050), so onConflict resolves cleanly.
    const { error } = await admin
        .from('wallets')
        .upsert(
            { shipowner_id: ctx.shipowner.id, auto_apply_to_proforma: parsed.enabled },
            { onConflict: 'shipowner_id' },
        );

    if (error) throw new Error(error.message);
}
