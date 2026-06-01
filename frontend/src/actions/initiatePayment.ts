'use server';

import { z } from 'zod';
import { lockRate } from '@/services/fxRateService';
import { createCheckoutSession } from '@/services/stripeService';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';

const OWNER_RAILS = ['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET', 'STRIPE'] as const;
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

    // Owner-initiated payment → scope to the operator's home jurisdiction so the
    // payments INSERT below is auto-stamped jurisdiction_id (matches ctx.shipowner).
    // fx_rates is global and passes through unchanged.
    const admin = createTenantClient(ctx.jurisdictionId);

    const fx = await lockRate(admin, parsed.currency);

    const amountMinor = Math.round(parseFloat(parsed.amount) * 100);
    const amountUsdMinor = parsed.currency === 'USD'
        ? amountMinor
        : Math.round(amountMinor / fx.rate);

    const rowCommon = {
        transaction_id: parsed.transactionId,
        shipowner_id: ctx.shipowner.id,
        declared_by: ctx.userId,
        amount_minor: amountMinor,
        currency: parsed.currency,
        amount_usd_minor: amountUsdMinor,
        fx_rate: parsed.currency === 'USD' ? null : fx.rate,
        fx_rate_source: parsed.currency === 'USD' ? null : fx.source,
        fx_rate_locked_at: parsed.currency === 'USD' ? null : fx.lockedAt,
        rail_details: parsed.railDetails,
    };

    if (parsed.rail === 'STRIPE') {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300';
        const invoiceId = parsed.transactionId ?? '';
        const session = await createCheckoutSession({
            // Option A: payment row id is not yet known. The webhook looks up by
            // external_reference = stripe_payment_intent_id, not by metadata.payment_id.
            paymentId: '',
            invoiceId,
            shipownerId: ctx.shipowner.id,
            amountUsdMinor,
            successUrl: `${baseUrl}/owner/invoices?stripe=success`,
            cancelUrl: `${baseUrl}/owner/invoices?stripe=cancel`,
        });

        const stripeRow = {
            ...rowCommon,
            rail: 'STRIPE' as const,
            status: 'PROCESSING' as const,
            external_reference: session.stripePaymentIntentId,
            rail_details: {
                ...parsed.railDetails,
                stripe_session_id: session.stripeSessionId,
                stripe_payment_intent_id: session.stripePaymentIntentId,
            },
        };

        const { data, error } = await admin
            .from('payments').insert(stripeRow).select('id, status, transaction_id, amount_usd_minor').single();
        if (error) throw error;
        return { ...data, checkoutUrl: session.checkoutUrl };
    }

    const row = {
        ...rowCommon,
        rail: parsed.rail,
        status: 'INITIATED' as const,
    };

    const { data, error } = await admin
        .from('payments').insert(row).select('id, status, transaction_id, amount_usd_minor').single();

    if (error) throw error;
    return data;
}
