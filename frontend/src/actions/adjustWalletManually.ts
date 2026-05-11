'use server';

import { createClient as createServiceClient } from '@supabase/supabase-js';
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
 *
 * RLS bypass: mig 050 enables RLS on wallet_ledger with NO policies. requireRole
 * above is the access gate (SUPERADMIN only). The service-role client just lets
 * the INSERT see the table. Mirrors the pattern in actions/applyWallet.ts.
 */
export async function adjustWalletManually(input: {
    walletId: string;
    amountSignedMinor: number;
    justification: string;
}): Promise<void> {
    const auth = await requireRole(SUPERADMIN_ONLY);
    if (auth.error) throw new Error('forbidden');
    if (!auth.user) throw new Error('unauthorized');

    const parsed = schema.parse(input);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createServiceClient(url, key);

    const { error } = await admin.from('wallet_ledger').insert({
        wallet_id: parsed.walletId,
        amount_signed_usd_minor: parsed.amountSignedMinor,
        kind: 'ADMIN_ADJUSTMENT',
        created_by: auth.user.id,
        justification: parsed.justification,
    });
    if (error) throw new Error(error.message);
}
