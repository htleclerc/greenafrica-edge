'use server';

import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { z } from 'zod';

const SUPERADMIN_ONLY = [UserRole.SUPERADMIN];

const schema = z.object({
    walletId: z.string().uuid(),
    amountSignedMinor: z.number().int().refine((n) => n !== 0, 'amount must be non-zero'),
    justification: z.string().min(5, 'justification must be at least 5 characters'),
});

/**
 * Manual wallet adjustment by SUPERADMIN.
 *
 * INSERTs a `wallet_ledger` row with `kind='ADMIN_ADJUSTMENT'`. The apply_ledger_to_wallet
 * trigger (mig 050) updates `wallets.balance_usd_minor` atomically with a row-level lock.
 *
 * Validation:
 *  - SUPERADMIN role only (NOT FINANCE_ADMIN, NOT MANAGER) — spec §8.4
 *  - amount must be non-zero (DB CHECK + zod refine)
 *  - justification ≥5 chars (DB CHECK: kind='ADMIN_ADJUSTMENT' requires non-null justification)
 *
 * The DB also enforces `wallets.balance_usd_minor >= 0` — a too-negative adjustment
 * will surface as a trigger error from the underlying `apply_ledger_to_wallet`.
 */
export async function adjustWalletManually(input: {
    walletId: string;
    amountSignedMinor: number;
    justification: string;
}): Promise<void> {
    const auth = await requireRole(SUPERADMIN_ONLY);
    if (auth.error) throw new Error('forbidden');

    const parsed = schema.parse(input);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('unauthorized');

    const { error } = await supabase.from('wallet_ledger').insert({
        wallet_id: parsed.walletId,
        amount_signed_usd_minor: parsed.amountSignedMinor,
        kind: 'ADMIN_ADJUSTMENT',
        created_by: user.id,
        justification: parsed.justification,
    });
    if (error) throw new Error(error.message);
}
