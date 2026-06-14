// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/invite-armateur
// ─────────────────────────────────────────────────────────────────────────────
//
// Creates a SHIPPING_AGENT account by invitation. The recipient gets an email
// with a signed login link → /auth/sl establishes a Supabase session →
// /auth/setup-password lets them choose a password → /dashboard.
//
// Allowed roles: PORT_OFFICER, SUPERADMIN.
//   - The created profile is is_active=true (the invitation IS the approval —
//     skip the registration_requests review queue).
//
// Idempotency: if the email already exists, return 409. The caller can then
// fall back to /api/auth/approve (for self-signed-up users) or contact support.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { createSignedLoginUrl } from '@/lib/auth/signedLink';
import { UserRole } from '@/types/secure';
import { sendArmateurInviteEmail } from '@/services/emailService';
import { createPlatformClient } from '@/lib/supabase/tenant';

const INVITER_ROLES = [UserRole.SUPERADMIN, UserRole.PORT_OFFICER];

const inviteSchema = z.object({
    email: z.email(),
    fullName: z.string().min(2).max(100),
    orgName: z.string().min(2).max(200).optional(),
    jurisdiction: z.string().max(100).optional(),
});

const TTL_HOURS = 6;

export async function POST(request: NextRequest) {
    const auth = await requireRole(INVITER_ROLES);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => null);
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'Validation failed', details: parsed.error.issues.map((i) => i.message) },
            { status: 400 },
        );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const fullName = parsed.data.fullName.trim();
    const { orgName, jurisdiction } = parsed.data;

    // Creates a global staff (SHIPPING_AGENT) profile — profiles is not tenant-scoped
    // (jurisdiction membership lives in user_jurisdictions) → UNSCOPED platform client.
    const adminClient = createPlatformClient();

    // 1. Check duplicate
    const { data: existing } = await adminClient
        .from('profiles')
        .select('id, role, is_active')
        .eq('email', email)
        .limit(1);

    if (existing && existing.length > 0) {
        return NextResponse.json(
            { error: 'An account with this email already exists' },
            { status: 409 },
        );
    }

    // 2. Create auth user — email_confirm=true so they don't need to verify
    //    their email separately. They have NO password until they set one
    //    via /auth/setup-password (Supabase requires SOMETHING; we use a
    //    cryptographically-random throwaway that the user will overwrite).
    const throwawayPassword = `tmp_${crypto.randomUUID()}_${Date.now()}`;
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password: throwawayPassword,
        email_confirm: true,
        user_metadata: {
            full_name: fullName,
            role: 'SHIPPING_AGENT',
            invited_by: auth.user.id,
            invited_by_name: auth.user.fullName,
            org_name: orgName ?? null,
        },
    });

    if (createError || !createData?.user) {
        console.error('[invite-armateur] auth.admin.createUser failed:', createError);
        return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }

    const userId = createData.user.id;

    // 3. Upsert profile — invited = approved (is_active=true)
    //    SUPERADMIN sees this in the audit log; the invite trail is in
    //    user_metadata.invited_by for traceability.
    const { error: profileError } = await adminClient
        .from('profiles')
        .upsert({
            id: userId,
            email,
            full_name: fullName,
            role: 'SHIPPING_AGENT',
            operational_site: 'BERBERA_PORT',
            country_code: jurisdiction === 'Djibouti' ? 'DJ' : 'SO',
            timezone: 'Africa/Mogadishu',
            preferred_language: 'en',
            is_active: true,
            is_demo: false,
        }, { onConflict: 'id' });

    if (profileError) {
        // Rollback: delete the auth user so the email isn't permanently taken
        await adminClient.auth.admin.deleteUser(userId).catch(() => {});
        console.error('[invite-armateur] profile upsert failed:', profileError);
        return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
    }

    // 4. Generate the signed invitation URL (HS256 envelope, 6h TTL,
    //    redirects to /auth/setup-password after auth).
    const origin = request.nextUrl.origin;
    let inviteUrl: string;
    try {
        inviteUrl = createSignedLoginUrl(email, origin, {
            ttlHours: TTL_HOURS,
            redirectPath: '/auth/setup-password',
        });
    } catch (err) {
        // Cleanup the just-created user since we can't deliver the invite.
        await adminClient.auth.admin.deleteUser(userId).catch(() => {});
        console.error('[invite-armateur] signed link generation failed:', err);
        return NextResponse.json(
            { error: 'Server not configured for invitations (missing SIGNED_LINK_SECRET)' },
            { status: 500 },
        );
    }

    // 5. Send the email (best-effort — if it fails, we still return the
    //    inviteUrl so the inviter can copy/paste it manually).
    let emailResult: { success: boolean; id?: string; error?: string } = { success: false };
    try {
        emailResult = await sendArmateurInviteEmail({
            to: email,
            recipientName: fullName,
            inviterName: auth.user.fullName,
            orgName,
            inviteUrl,
            ttlHours: TTL_HOURS,
        });
        if (!emailResult.success) {
            console.warn('[invite-armateur] email send failed:', emailResult.error);
        }
    } catch (err) {
        console.warn('[invite-armateur] email send threw:', err);
    }

    // 6. Audit log entry — invitation is a notable RBAC action even though
    //    it's not money-rail. Best-effort: a failure here doesn't undo the
    //    invitation (the auth user + profile are already committed and the
    //    email may have gone out).
    try {
        const { error: auditErr } = await adminClient.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: auth.user.fullName,
            action: 'USER_CREATED',
            severity: 'INFO',
            entity_type: 'Profile',
            entity_id: userId,
            details_json: {
                event: 'ARMATEUR_INVITED',
                invitedEmail: email,
                invitedName: fullName,
                orgName: orgName ?? null,
                inviterRole: auth.user.role,
                ttlHours: TTL_HOURS,
                emailDelivered: emailResult.success,
            },
        });
        if (auditErr) console.warn('[invite-armateur] audit log insert failed:', auditErr.message);
    } catch (e) {
        console.warn('[invite-armateur] audit log threw:', e);
    }

    return NextResponse.json({
        success: true,
        userId,
        email,
        inviteUrl,
        emailDelivered: emailResult.success,
        // Surface the URL even on email failure so the inviter has a fallback.
        ttlHours: TTL_HOURS,
    });
}
