'use server';

import { requireRole } from '@/lib/auth/requireRole';
import { scopedLogger } from '@/lib/logger';
import { UserRole } from '@/types/secure';
import { z } from 'zod';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';

const log = scopedLogger('adjustWalletManually');

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

    log.info('action_invoked', {
        walletId: parsed.walletId,
        userId: auth.user.id,
    });

    // Resolve the wallet's jurisdiction (Model B: wallet inherits the operator's),
    // confine the admin to it (SUPERADMIN may act on any), and stamp the ledger row
    // with that jurisdiction via the scoped client.
    const platform = createPlatformClient();
    const { data: wallet, error: wErr } = await platform
        .from('wallets')
        .select('jurisdiction_id')
        .eq('id', parsed.walletId)
        .maybeSingle();
    if (wErr) throw new Error(wErr.message);
    if (!wallet) {
        log.error('wallet_manual_adjust_db_error', {
            walletId: parsed.walletId,
            error: 'wallet not found',
        });
        throw new Error('Wallet not found');
    }
    const admin = createTenantClient(
        await assertAdminCanActOn(auth.user, (wallet as { jurisdiction_id: string }).jurisdiction_id),
    );

    const { error } = await admin.from('wallet_ledger').insert({
        wallet_id: parsed.walletId,
        amount_signed_usd_minor: parsed.amountSignedMinor,
        kind: 'ADMIN_ADJUSTMENT',
        created_by: auth.user.id,
        justification: parsed.justification,
    });
    if (error) {
        log.error('wallet_manual_adjust_db_error', {
            walletId: parsed.walletId,
            error: error.message,
        });
        throw new Error(error.message);
    }

    log.info('wallet_manually_adjusted', {
        walletId: parsed.walletId,
        deltaUsdMinor: parsed.amountSignedMinor,
        justificationLen: parsed.justification.length,
        userId: auth.user.id,
    });
}
