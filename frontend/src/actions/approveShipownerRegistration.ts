'use server';

import { z } from 'zod';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';

const schema = z.object({ shipownerId: z.string().uuid() });

/**
 * Approve a shipowner's pending registration.
 * - Changes account_state from PENDING_REVIEW to ACTIVE
 * - Issues Supabase auth invite to official_email
 * - Creates/upserts profiles row with role=SHIPOWNER
 * - Creates wallet record
 * - Logs action to audit_logs
 */
export async function approveShipownerRegistration(input: unknown) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, message: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const { shipownerId } = parsed.data;

    // 1. Check auth + get current user
    const supabase = await import('@/lib/supabase/server').then(m => m.createClient());
    const { data: authUser } = await supabase.auth.getUser();
    if (!authUser?.user) return { ok: false, message: 'not authenticated' };

    // 2. Check role (SUPERADMIN only)
    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', authUser.user.id)
        .single();
    const ALLOWED_ROLES = ['SUPERADMIN'];
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, message: 'insufficient role' };
    }

    // 3. Load the shipowner (regardless of tenant) to resolve its jurisdiction.
    const platform = createPlatformClient();
    const { data: row } = await platform
        .from('shipowners')
        .select('id, official_email, account_state, name, preferred_language, jurisdiction_id')
        .eq('id', shipownerId)
        .single();
    if (!row) return { ok: false, message: 'not_found' };
    if (row.account_state !== 'PENDING_REVIEW') return { ok: false, message: 'not_pending' };
    if (!row.official_email) return { ok: false, message: 'no_email' };

    // 4. Staff isolation: a non-SUPERADMIN admin may only approve registrations in their
    //    own jurisdiction. All writes then run through a client scoped to the operator's
    //    jurisdiction so the wallet + notification are stamped correctly.
    const jurisdictionId = (row as { jurisdiction_id: string }).jurisdiction_id;
    if (profile.role !== 'SUPERADMIN') {
        const adminJurisdictionId = await getServerJurisdictionId();
        if (adminJurisdictionId !== jurisdictionId) {
            return { ok: false, message: 'forbidden_jurisdiction' };
        }
    }
    const admin = createTenantClient(jurisdictionId);

    // 5. Update account_state to ACTIVE
    const { error: updateErr } = await admin
        .from('shipowners')
        .update({ account_state: 'ACTIVE' })
        .eq('id', shipownerId);
    if (updateErr) return { ok: false, message: `update failed: ${updateErr.message}` };

    // 6. Invite user via auth
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300';
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
        row.official_email,
        { redirectTo: `${appUrl}/owner/auth/callback` },
    );

    if (!invited?.user || inviteErr) {
        // Rollback account_state
        await admin.from('shipowners')
            .update({ account_state: 'PENDING_REVIEW' })
            .eq('id', shipownerId);
        return { ok: false, message: `invite failed: ${inviteErr?.message ?? 'unknown'}` };
    }

    const userId = invited.user.id;

    // 7. Upsert profile
    const { error: profileErr } = await admin
        .from('profiles')
        .upsert({
            id: userId,
            email: row.official_email,
            full_name: row.name,
            role: 'SHIPOWNER',
            is_active: true,
        }, { onConflict: 'id' });
    if (profileErr) {
        await admin.from('shipowners')
            .update({ account_state: 'PENDING_REVIEW' })
            .eq('id', shipownerId);
        return { ok: false, message: `profile upsert failed: ${profileErr.message}` };
    }

    // 8. Update shipowners with profile_id
    const { error: ownerErr } = await admin
        .from('shipowners')
        .update({ profile_id: userId })
        .eq('id', shipownerId);
    if (ownerErr) {
        return { ok: false, message: `shipowner link failed: ${ownerErr.message}` };
    }

    // 9. Create wallet
    const { error: walletErr } = await admin
        .from('wallets')
        .insert({ shipowner_id: shipownerId });
    if (walletErr && !walletErr.message?.includes('duplicate')) {
        // Ignore duplicate key errors (wallet may already exist)
        return { ok: false, message: `wallet creation failed: ${walletErr.message}` };
    }

    // 10. Audit log
    const { error: auditErr } = await admin.from('audit_logs').insert({
        user_id: authUser.user.id,
        user_full_name: profile.full_name ?? 'Admin',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Shipowner',
        entity_id: shipownerId,
        jurisdiction_id: jurisdictionId,
        details_json: { event: 'SHIPOWNER_REVIEW_APPROVED' },
    });
    if (auditErr) {
        console.error('Audit log failed:', auditErr);
        // Non-fatal, continue
    }

    // Plan 7F: in-app notification (activation email already dispatched above
    // by the invite flow with full activation context). Fail-soft.
    try {
        const { notifyOwner } = await import('@/services/notificationService');
        await notifyOwner(admin, {
            shipownerId,
            kind: 'KYC_APPROVED',
            params: { shipowner_name: row.name ?? 'Shipowner' },
            deepLink: '/owner',
            skipEmail: true,
        });
    } catch (notifyErr) {
        console.error('[approveShipownerRegistration] notifyOwner failed:', notifyErr);
    }

    return { ok: true };
}
