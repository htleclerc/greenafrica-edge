'use server';

import { z } from 'zod';
import { sendShipownerRejectionEmail } from '@/services/emailService';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';

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

    // 3. Load the shipowner (regardless of tenant) to resolve its jurisdiction.
    const platform = createPlatformClient();
    const { data: row } = await platform
        .from('shipowners')
        .select('id, official_email, account_state, preferred_language, jurisdiction_id')
        .eq('id', shipownerId)
        .single();
    if (!row) return { ok: false, message: 'not_found' };
    if (row.account_state !== 'PENDING_REVIEW') return { ok: false, message: 'not_pending' };

    // 4. Staff isolation: a non-SUPERADMIN admin may only reject registrations in
    //    their own jurisdiction. All writes then run through a scoped client.
    const jurisdictionId = (row as { jurisdiction_id: string }).jurisdiction_id;
    if (profile.role !== 'SUPERADMIN') {
        const adminJurisdictionId = await getServerJurisdictionId();
        if (adminJurisdictionId !== jurisdictionId) {
            return { ok: false, message: 'forbidden_jurisdiction' };
        }
    }
    const admin = createTenantClient(jurisdictionId);

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

    // Plan 7F: in-app notification — rejection email already dispatched above
    // by sendShipownerRejectionEmail, so pass skipEmail to avoid duplicates. Fail-soft.
    try {
        const { notifyOwner } = await import('@/services/notificationService');
        await notifyOwner(admin, {
            shipownerId,
            kind: 'KYC_REJECTED',
            params: { reason },
            deepLink: '/owner/onboarding/billing',
            skipEmail: true,
        });
    } catch (notifyErr) {
        console.error('[rejectShipownerRegistration] notifyOwner failed:', notifyErr);
    }

    return { ok: true };
}
