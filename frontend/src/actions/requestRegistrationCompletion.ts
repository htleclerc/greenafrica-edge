'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { UserRole } from '@/types/secure';
import { requireRole } from '@/lib/auth/requireRole';
import { sendShipownerCompletionRequestEmail } from '@/services/emailService';

const schema = z.object({
    shipownerId: z.string().uuid(),
    missingItems: z.string().min(5).max(2000),
});

/**
 * Request additional information from a shipowner with a pending registration.
 * Sends an email listing the missing items needed to complete the registration.
 */
export async function requestRegistrationCompletion(input: unknown) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, message: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const { shipownerId, missingItems } = parsed.data;

    await requireRole([UserRole.SUPERADMIN, UserRole.MANAGER]);

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Check state before sending email
    const { data: row } = await admin
        .from('shipowners')
        .select('account_state')
        .eq('id', shipownerId)
        .single();
    if (!row) return { ok: false, message: 'not_found' };
    if (row.account_state !== 'PENDING_REVIEW') return { ok: false, message: 'not_pending' };

    // Send email
    try {
        await sendShipownerCompletionRequestEmail({ shipownerId, missingItems });
        return { ok: true };
    } catch (err) {
        return { ok: false, message: `email send failed: ${err instanceof Error ? err.message : 'unknown'}` };
    }
}
