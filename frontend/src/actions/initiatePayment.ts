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

interface InitiatePaymentInput {
    transactionId: string | null;
    amount: string;
    currency: string;
    rail: typeof ALL_RAILS[number];
    railDetails: Record<string, unknown>;
}

export async function initiatePayment(input: InitiatePaymentInput) {
    // Inline validation to avoid Zod v4 test env issues
    if (input.transactionId !== null && !(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.transactionId))) {
        throw new Error('Invalid UUID for transactionId');
    }
    if (!input.amount || !/^\d+(\.\d{1,2})?$/.test(input.amount)) {
        throw new Error('Invalid amount format');
    }
    if (!input.currency || input.currency.length !== 3) {
        throw new Error('Invalid currency');
    }
    if (!input.rail || typeof input.rail !== 'string') {
        throw new Error('Invalid rail');
    }
    if (typeof input.railDetails !== 'object' || input.railDetails === null) {
        throw new Error('Invalid railDetails');
    }

    const ctx = await requireOwner();
    if (!OWNER_RAILS.includes(input.rail as typeof OWNER_RAILS[number])) {
        throw new Error(`owner cannot initiate rail=${input.rail}`);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const fx = await lockRate(admin, input.currency);

    const amountMinor = Math.round(parseFloat(input.amount) * 100);
    const amountUsdMinor = input.currency === 'USD'
        ? amountMinor
        : Math.round(amountMinor / fx.rate);

    const row = {
        transaction_id: input.transactionId,
        shipowner_id: ctx.shipowner.id,
        declared_by: ctx.userId,
        amount_minor: amountMinor,
        currency: input.currency,
        amount_usd_minor: amountUsdMinor,
        fx_rate: input.currency === 'USD' ? null : fx.rate,
        fx_rate_source: input.currency === 'USD' ? null : fx.source,
        fx_rate_locked_at: input.currency === 'USD' ? null : fx.lockedAt,
        rail: input.rail,
        rail_details: input.railDetails,
        status: 'INITIATED' as const,
    };

    const { data, error } = await admin
        .from('payments').insert(row).select('id, status, transaction_id, amount_usd_minor').single();

    if (error) throw error;
    return data;
}
