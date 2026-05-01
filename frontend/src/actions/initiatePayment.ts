'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { lockRate } from '@/services/fxRateService';
import { requireOwner } from '@/lib/auth/requireOwner';

const OWNER_RAILS = ['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET'] as const;
const ALL_RAILS = [
    'STRIPE', 'WIRE_TRANSFER', 'CASH', 'CHEQUE', 'LETTER_OF_CREDIT',
    'NETTING', 'THIRD_PARTY', 'MOBILE_MONEY', 'BANK_GUARANTEE', 'WALLET',
] as const;

const schema = z.object({
    transactionId: z.string().uuid().nullable(),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Decimal with up to 2 fraction digits'),
    currency: z.string().length(3),
    rail: z.enum(ALL_RAILS),
    railDetails: z.record(z.string(), z.unknown()),
});

interface InitiatePaymentInput {
    transactionId: string | null;
    amount: string;
    currency: string;
    rail: typeof ALL_RAILS[number];
    railDetails: Record<string, unknown>;
}

export async function initiatePayment(input: InitiatePaymentInput) {
    const parsed = schema.parse(input);

    const ctx = await requireOwner();
    if (!OWNER_RAILS.includes(parsed.rail as typeof OWNER_RAILS[number])) {
        throw new Error(`owner cannot initiate rail=${parsed.rail}`);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const fx = await lockRate(admin, parsed.currency);

    const amountMinor = Math.round(parseFloat(parsed.amount) * 100);
    const amountUsdMinor = parsed.currency === 'USD'
        ? amountMinor
        : Math.round(amountMinor / fx.rate);

    const row = {
        transaction_id: parsed.transactionId,
        shipowner_id: ctx.shipowner.id,
        declared_by: ctx.userId,
        amount_minor: amountMinor,
        currency: parsed.currency,
        amount_usd_minor: amountUsdMinor,
        fx_rate: parsed.currency === 'USD' ? null : fx.rate,
        fx_rate_source: parsed.currency === 'USD' ? null : fx.source,
        fx_rate_locked_at: parsed.currency === 'USD' ? null : fx.lockedAt,
        rail: parsed.rail,
        rail_details: parsed.railDetails,
        status: 'INITIATED' as const,
    };

    const { data, error } = await admin
        .from('payments').insert(row).select('id, status, transaction_id, amount_usd_minor').single();

    if (error) throw error;
    return data;
}
