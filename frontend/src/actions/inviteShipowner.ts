'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';

const schema = z.object({
    shipownerId: z.string().uuid(),
    email: z.email(),
});

const ALLOWED_ROLES = ['SUPERADMIN', 'MANAGER'] as const;

export type InviteShipownerResult =
    | { ok: true; userId: string; alreadyExisted: boolean }
    | { ok: false; reason: string };

/**
 * Grant portal access to a shipowner. Only SUPERADMIN and MANAGER can
 * invite — gating is intentionally stricter than the page itself
 * (which PORT_OFFICER can also access for the mappings work).
 *
 * Flow:
 *   1. Load shipowners row, refuse if account_state='ACTIVE' (already in)
 *   2. Issue Supabase invite — creates auth.users (or links existing) and
 *      sends the invite email via Supabase's configured SMTP. The redirect
 *      points at /owner/auth/callback which Plan 6 Task 2 will implement.
 *   3. Upsert profiles row with role='SHIPOWNER', is_active=true.
 *      (Admin invitation IS the approval — no second-step approval like
 *      /api/auth/approve does for staff.)
 *   4. Update shipowners row with profile_id, account_state='INVITED',
 *      invited_at, invited_by. Also stamps official_email if missing
 *      (PORT_OFFICER source = highest trust, since an admin sent the invite).
 */
export async function inviteShipowner(raw: unknown): Promise<InviteShipownerResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return { ok: false, reason: 'service role not configured' };
    }
    const admin = createServiceRole(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
    });

    const email = parsed.data.email.trim().toLowerCase();

    // 1. Load + validate shipowner
    const { data: owner, error: ownerErr } = await admin
        .from('shipowners')
        .select('id, name, account_state, profile_id, official_email, official_email_source')
        .eq('id', parsed.data.shipownerId)
        .single();
    if (ownerErr || !owner) return { ok: false, reason: 'shipowner not found' };
    if (owner.account_state === 'ACTIVE') {
        return { ok: false, reason: 'shipowner is already active in the portal' };
    }

    // 2. Issue invite (or look up existing user)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300';
    let userId: string;
    let alreadyExisted = false;

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${appUrl}/owner/auth/callback`,
        data: { full_name: owner.name, role: 'SHIPOWNER' },
    });

    if (invited?.user) {
        userId = invited.user.id;
    } else if (
        inviteErr &&
        (inviteErr.code === 'email_exists' ||
            /already.*registered|already.*been.*registered/i.test(inviteErr.message ?? ''))
    ) {
        // Existing user — find them. Use the v1 admin listUsers paginated lookup
        // (supabase-js doesn't expose getUserByEmail directly).
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({
            page: 1,
            perPage: 200,
        });
        if (listErr) return { ok: false, reason: `lookup failed: ${listErr.message}` };
        const existing = list.users.find((u) => u.email?.toLowerCase() === email);
        if (!existing) return { ok: false, reason: 'user exists but cannot be located' };
        userId = existing.id;
        alreadyExisted = true;
    } else {
        return {
            ok: false,
            reason: `invite failed: ${inviteErr?.message ?? 'unknown error'}`,
        };
    }

    // 3. Upsert profile
    const { error: profileErr } = await admin
        .from('profiles')
        .upsert(
            {
                id: userId,
                email,
                full_name: owner.name,
                role: 'SHIPOWNER',
                is_active: true,
            },
            { onConflict: 'id' },
        );
    if (profileErr) {
        return { ok: false, reason: `profile upsert failed: ${profileErr.message}` };
    }

    // 4. Stamp shipowners row
    const updates: Record<string, unknown> = {
        profile_id: userId,
        account_state: 'INVITED',
        invited_at: new Date().toISOString(),
        invited_by: auth.user.id,
    };
    // Only fill official_email if absent — don't overwrite a verified one
    if (!owner.official_email) {
        updates.official_email = email;
        updates.official_email_source = 'PORT_OFFICER';
    }

    const { error: ownerUpdateErr } = await admin
        .from('shipowners')
        .update(updates)
        .eq('id', parsed.data.shipownerId);
    if (ownerUpdateErr) {
        return { ok: false, reason: `shipowner update failed: ${ownerUpdateErr.message}` };
    }

    return { ok: true, userId, alreadyExisted };
}
