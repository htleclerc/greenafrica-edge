'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { sendShipownerRejectionEmail } from '@/services/emailService';

const schema = z.object({
    shipownerId: z.string().uuid(),
    reason: z.string().min(5).max(2000),
});

/**
 * Reject a shipowner's pending registration.
 * - Changes account_state to REJECTED
 * - Stores rejection_reason
 * - Sends rejection email
 * - Logs action to audit_logs
 */
export async function rejectShipownerRegistration(input: unknown) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, message: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const { shipownerId, reason } = parsed.data;

    // 1. Check auth + get current user
    const supabase = await import('@/lib/supabase/server').then(m => m.createClient());
    const { data: authUser } = await supabase.auth.getUser();
    if (!authUser?.user) return { ok: false, message: 'not authenticated' };

    // 2. Check role (SUPERADMIN or MANAGER)
    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', authUser.user.id)
        .single();
    const ALLOWED_ROLES = ['SUPERADMIN', 'MANAGER'];
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, message: 'insufficient role' };
    }

    // 3. Create service role client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return { ok: false, message: 'service role not configured' };
    }
    const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
    });

    // 4. Load shipowner
    const { data: row } = await admin
        .from('shipowners')
        .select('id, official_email, account_state, preferred_language')
        .eq('id', shipownerId)
        .single();
    if (!row) return { ok: false, message: 'not_found' };
    if (row.account_state !== 'PENDING_REVIEW') return { ok: false, message: 'not_pending' };

    // 5. Update account_state and store reason
    const { error: updateErr } = await admin
        .from('shipowners')
        .update({
            account_state: 'REJECTED',
            rejection_reason: reason,
        })
        .eq('id', shipownerId);
    if (updateErr) return { ok: false, message: `update failed: ${updateErr.message}` };

    // 6. Send rejection email (non-blocking)
    if (row.official_email) {
        try {
            await sendShipownerRejectionEmail({
                to: row.official_email,
                reason,
                language: row.preferred_language ?? 'en',
            });
        } catch (err) {
            console.error('Email send failed:', err);
            // Non-fatal, continue
        }
    }

    // 7. Audit log
    const { error: auditErr } = await admin.from('audit_logs').insert({
        user_id: authUser.user.id,
        user_full_name: profile.full_name ?? 'Admin',
        action: 'TRANSACTION_UPDATED',
        severity: 'WARNING',
        entity_type: 'Shipowner',
        entity_id: shipownerId,
        details_json: {
            event: 'SHIPOWNER_REVIEW_REJECTED',
            reason,
        },
    });
    if (auditErr) {
        console.error('Audit log failed:', auditErr);
        // Non-fatal, continue
    }

    return { ok: true };
}
