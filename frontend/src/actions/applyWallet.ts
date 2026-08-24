'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';
import { applyWalletCredit } from '@/services/walletApplyService';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('applyWallet');

const schema = z.object({
    transactionId: z.string().uuid(),
    amountMinor: z.number().int().positive(),
});

/**
 * Applique du credit de portefeuille sur une facture de l'armateur connecte.
 *
 * Le montant n'a pas a couvrir la facture entiere : un paiement mixte
 * (portefeuille + carte) passe par `initiatePayment`, qui appelle le meme
 * service. L'ecriture comptable est identique dans les deux cas.
 */
export async function applyWallet(input: { transactionId: string; amountMinor: number }) {
    const parsed = schema.parse(input);

    const ctx = await requireOwner('canPay');

    log.info('action_invoked', {
        transactionId: parsed.transactionId,
        userId: ctx.userId,
        shipownerId: ctx.shipowner.id,
        amountUsdMinor: parsed.amountMinor,
    });

    const admin = createTenantClient(ctx.jurisdictionId);

    // La facture doit appartenir a l'armateur de la session.
    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .select('id, shipowner_id, tax_amount_usd')
        .eq('id', parsed.transactionId)
        .single();
    if (txErr) throw txErr;
    if (tx.shipowner_id !== ctx.shipowner.id) throw new Error('Not your transaction');

    await applyWalletCredit(admin, {
        transactionId: parsed.transactionId,
        shipownerId: ctx.shipowner.id,
        actorUserId: ctx.userId,
        amountMinor: parsed.amountMinor,
    });

    return { ok: true };
}
