'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('applyWallet');

const schema = z.object({
    transactionId: z.string().uuid(),
    amountMinor: z.number().int().positive(),
});

export async function applyWallet(input: { transactionId: string; amountMinor: number }) {
    const parsed = schema.parse(input);

    const ctx = await requireOwner();

    log.info('action_invoked', {
        transactionId: parsed.transactionId,
        userId: ctx.userId,
        shipownerId: ctx.shipowner.id,
        amountUsdMinor: parsed.amountMinor,
    });

    const admin = createTenantClient(ctx.jurisdictionId);

    // Verify transaction belongs to this shipowner and fetch due amount
    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .select('id, shipowner_id, tax_amount_usd')
        .eq('id', parsed.transactionId)
        .single();
    if (txErr) throw txErr;
    if (tx.shipowner_id !== ctx.shipowner.id) throw new Error('Not your transaction');

    // Verify wallet balance + fetch wallet.id for ledger insert
    const { data: wallet, error: wErr } = await admin
        .from('wallets')
        .select('id, balance_usd_minor')
        .eq('shipowner_id', ctx.shipowner.id)
        .maybeSingle();
    if (wErr) throw wErr;
    if (!wallet) {
        log.warn('wallet_insufficient_funds', {
            transactionId: parsed.transactionId,
            shipownerId: ctx.shipowner.id,
            reason: 'no_wallet',
            requestedUsdMinor: parsed.amountMinor,
        });
        throw new Error('Insufficient wallet balance');
    }
    const balance = wallet.balance_usd_minor ?? 0;
    if (balance < parsed.amountMinor) {
        log.warn('wallet_insufficient_funds', {
            transactionId: parsed.transactionId,
            shipownerId: ctx.shipowner.id,
            walletId: wallet.id,
            balanceUsdMinor: balance,
            requestedUsdMinor: parsed.amountMinor,
        });
        throw new Error('Insufficient wallet balance');
    }

    // Insert WALLET payment CONFIRMED (owner is the actor → confirmed_by=userId)
    const confirmedAt = new Date().toISOString();
    const { error: payErr } = await admin
        .from('payments')
        .insert({
            transaction_id: parsed.transactionId,
            shipowner_id: ctx.shipowner.id,
            declared_by: ctx.userId,
            amount_minor: parsed.amountMinor,
            currency: 'USD',
            amount_usd_minor: parsed.amountMinor,
            rail: 'WALLET',
            status: 'CONFIRMED',
            confirmed_by: ctx.userId,
            confirmed_at: confirmedAt,
            rail_details: { applied_by_owner: true },
        })
        .select('id')
        .single();
    if (payErr) {
        log.error('wallet_apply_db_error', {
            transactionId: parsed.transactionId,
            walletId: wallet.id,
            stage: 'payments_insert',
            error: payErr.message,
        });
        throw payErr;
    }

    // Ledger debit (negative signed) — wallet trigger syncs balance
    const { error: ledgErr } = await admin.from('wallet_ledger').insert({
        wallet_id: wallet.id,
        kind: 'PROFORMA_APPLY',
        amount_signed_usd_minor: -parsed.amountMinor,
        created_by: ctx.userId,
    });
    if (ledgErr) {
        log.error('wallet_apply_db_error', {
            transactionId: parsed.transactionId,
            walletId: wallet.id,
            stage: 'wallet_ledger_insert',
            error: ledgErr.message,
        });
        throw ledgErr;
    }

    // Recompute transaction status
    const { error: rpcErr } = await admin.rpc('recompute_transaction_status', {
        p_txn_id: parsed.transactionId,
    });
    if (rpcErr) {
        // Payments trigger recomputes too — log, don't roll back the apply.
        log.error('recompute_transaction_status_failed', {
            transactionId: parsed.transactionId,
            walletId: wallet.id,
            error: rpcErr.message,
        });
    }

    log.info('wallet_applied', {
        transactionId: parsed.transactionId,
        walletId: wallet.id,
        amountUsdMinor: parsed.amountMinor,
    });

    return { ok: true };
}
