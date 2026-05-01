'use server';

import { z } from 'zod';
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

    // 1. Check auth + get current user
    const supabase = await import('@/lib/supabase/server').then(m => m.createClient());
    const { data: authUser } = await supabase.auth.getUser();
    if (!authUser?.user) return { ok: false, message: 'not authenticated' };

    // 2. Check role (SUPERADMIN or MANAGER)
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authUser.user.id)
        .single();
    const ALLOWED_ROLES = ['SUPERADMIN', 'MANAGER'];
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, message: 'insufficient role' };
    }

    // 3. Send email
    try {
        await sendShipownerCompletionRequestEmail({ shipownerId, missingItems });
        return { ok: true };
    } catch (err) {
        return { ok: false, message: `email send failed: ${err instanceof Error ? err.message : 'unknown'}` };
    }
}
