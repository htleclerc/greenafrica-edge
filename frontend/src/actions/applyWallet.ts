'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';

const schema = z.object({
    transactionId: z.string().uuid(),
    amountMinor: z.number().int().positive(),
});

export async function applyWallet(input: { transactionId: string; amountMinor: number }) {
    const parsed = schema.parse(input);

    const ctx = await requireOwner();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

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
    if (!wallet) throw new Error('Insufficient wallet balance');
    const balance = wallet.balance_usd_minor ?? 0;
    if (balance < parsed.amountMinor) {
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
    if (payErr) throw payErr;

    // Ledger debit (negative signed) — wallet trigger syncs balance
    const { error: ledgErr } = await admin.from('wallet_ledger').insert({
        wallet_id: wallet.id,
        kind: 'PROFORMA_APPLY',
        amount_signed_usd_minor: -parsed.amountMinor,
        created_by: ctx.userId,
    });
    if (ledgErr) throw ledgErr;

    // Recompute transaction status
    await admin.rpc('recompute_transaction_status', { p_transaction_id: parsed.transactionId });

    return { ok: true };
}
