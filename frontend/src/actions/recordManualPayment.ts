'use server';

import { createClient } from '@/lib/supabase/server';
import { lockRate } from '@/services/fxRateService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { z } from 'zod';

const ADMIN_ONLY_RAILS = [
    'CASH',
    'CHEQUE',
    'LETTER_OF_CREDIT',
    'NETTING',
    'THIRD_PARTY',
    'BANK_GUARANTEE',
] as const;
type AdminRail = typeof ADMIN_ONLY_RAILS[number];

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

const schema = z.object({
    shipownerId: z.string().uuid(),
    transactionId: z.string().uuid().nullable(),
    rail: z.enum(ADMIN_ONLY_RAILS),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Decimal with up to 2 fraction digits'),
    currency: z.string().length(3),
    railDetails: z.record(z.string(), z.unknown()),
    confirmImmediately: z.boolean(),
});

export interface RecordManualPaymentInput {
    shipownerId: string;
    transactionId: string | null;
    rail: AdminRail;
    amount: string;
    currency: string;
    railDetails: Record<string, unknown>;
    confirmImmediately: boolean;
}

/**
 * Admin-side INSERT into `payments` for the 6 admin-only rails.
 * - declared_by = current admin user id
 * - status = INITIATED unless `confirmImmediately` AND rail !== CASH
 * - CASH is FORCED to INITIATED regardless of the flag (4-eyes per mig 057).
 *   The second admin must call confirmPayment() to flip to CONFIRMED.
 */
export async function recordManualPayment(input: RecordManualPaymentInput) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) throw new Error('forbidden');

    const parsed = schema.parse(input);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('unauthorized');

    const fx = await lockRate(supabase, parsed.currency);
    const amountMinor = Math.round(parseFloat(parsed.amount) * 100);
    const amountUsdMinor = parsed.currency === 'USD'
        ? amountMinor
        : Math.round(amountMinor / fx.rate);

    // Force INITIATED for CASH (4-eyes rule encoded in can_confirm_payment, mig 057)
    const status = (parsed.rail === 'CASH' || !parsed.confirmImmediately)
        ? 'INITIATED'
        : 'CONFIRMED';

    const row = {
        transaction_id: parsed.transactionId,
        shipowner_id: parsed.shipownerId,
        declared_by: user.id,
        amount_minor: amountMinor,
        currency: parsed.currency,
        amount_usd_minor: amountUsdMinor,
        fx_rate: parsed.currency === 'USD' ? null : fx.rate,
        fx_rate_source: parsed.currency === 'USD' ? null : fx.source,
        fx_rate_locked_at: parsed.currency === 'USD' ? null : fx.lockedAt,
        rail: parsed.rail,
        rail_details: parsed.railDetails,
        status,
        confirmed_by: status === 'CONFIRMED' ? user.id : null,
        confirmed_at: status === 'CONFIRMED' ? new Date().toISOString() : null,
    };

    const { data, error } = await supabase
        .from('payments')
        .insert(row)
        .select('id, status, transaction_id, amount_usd_minor')
        .single();

    if (error) throw error;
    return data;
}
