'use server';

import { z } from 'zod';
import { UserRole } from '@/types/secure';
import { requireRole } from '@/lib/auth/requireRole';
import { sendShipownerCompletionRequestEmail } from '@/services/emailService';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';

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

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.MANAGER]);
    if (auth.error) return { ok: false, message: 'insufficient role' };

    // Load the shipowner (regardless of tenant) + confine the acting admin to its
    // jurisdiction before sending the completion-request email.
    const platform = createPlatformClient();
    const { data: row } = await platform
        .from('shipowners')
        .select('account_state, jurisdiction_id')
        .eq('id', shipownerId)
        .single();
    if (!row) return { ok: false, message: 'not_found' };
    if (row.account_state !== 'PENDING_REVIEW') return { ok: false, message: 'not_pending' };
    try {
        await assertAdminCanActOn(auth.user, (row as { jurisdiction_id: string }).jurisdiction_id);
    } catch {
        return { ok: false, message: 'forbidden_jurisdiction' };
    }

    // Send email
    try {
        await sendShipownerCompletionRequestEmail({ shipownerId, missingItems });
        return { ok: true };
    } catch (err) {
        return { ok: false, message: `email send failed: ${err instanceof Error ? err.message : 'unknown'}` };
    }
}
