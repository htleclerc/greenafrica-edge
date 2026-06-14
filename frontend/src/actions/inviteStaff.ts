'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

// Staff roles that can be created via admin invitation.
// SUPERADMIN and SHIPPING_AGENT are excluded: SUPERADMIN is provisioned out-of-band,
// and SHIPPING_AGENT is an operator role (self-service via /signup).
const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

const schema = z.object({
    email: z.string().email(),
    fullName: z.string().min(2).max(120),
    role: z.enum(STAFF_ROLES),
    jurisdictionIds: z.array(z.string().uuid()).min(1),
});

export type InviteStaffResult =
    | { ok: true; userId: string; alreadyExisted: boolean }
    | { ok: false; reason: string };

/**
 * Invite a new staff member to the platform. SUPERADMIN only.
 *
 * Flow:
 *   1. Verify caller is SUPERADMIN.
 *   2. Issue Supabase invite — creates auth.users (or links existing) and
 *      sends the invite email via Supabase's configured SMTP. The redirect
 *      points at /auth/setup-password where the invitee sets their password.
 *   3. Upsert profiles row with the chosen staff role, is_active=true.
 *   4. Upsert user_jurisdictions rows (one per jurisdictionId).
 */
export async function inviteStaff(raw: unknown): Promise<InviteStaffResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    // ── 1. Auth + role gate ───────────────────────────────────────────────────
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: me } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (me?.role !== 'SUPERADMIN') return { ok: false, reason: 'insufficient role' };

    const { email, fullName, role, jurisdictionIds } = parsed.data;
    const normEmail = email.trim().toLowerCase();
    const admin = createPlatformClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300';

    // ── 2. Issue invite (or resolve existing user) ────────────────────────────
    let userId: string;
    let alreadyExisted = false;

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
        normEmail,
        {
            redirectTo: `${appUrl}/auth/setup-password`,
            data: { full_name: fullName, role: role as StaffRole },
        },
    );

    if (invited?.user) {
        userId = invited.user.id;
    } else if (
        inviteErr &&
        (inviteErr.code === 'email_exists' ||
            /already.*registered|already.*been.*registered/i.test(inviteErr.message ?? ''))
    ) {
        // Existing user — find them via paginated list (supabase-js has no getUserByEmail).
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({
            page: 1,
            perPage: 200,
        });
        if (listErr) return { ok: false, reason: `lookup failed: ${listErr.message}` };
        const existing = list.users.find((u) => u.email?.toLowerCase() === normEmail);
        if (!existing) return { ok: false, reason: 'user exists but cannot be located' };
        userId = existing.id;
        alreadyExisted = true;
    } else {
        return { ok: false, reason: `invite failed: ${inviteErr?.message ?? 'unknown error'}` };
    }

    // ── 3. Upsert profiles row ────────────────────────────────────────────────
    const { error: profileErr } = await admin.from('profiles').upsert(
        { id: userId, email: normEmail, full_name: fullName, role, is_active: true },
        { onConflict: 'id' },
    );
    if (profileErr) {
        return { ok: false, reason: `profile upsert failed: ${profileErr.message}` };
    }

    // ── 4. Upsert user_jurisdictions rows ─────────────────────────────────────
    // PK constraint on (user_id, jurisdiction_id) from mig 071 — safe to upsert.
    const rows = jurisdictionIds.map((jid) => ({ user_id: userId, jurisdiction_id: jid }));
    const { error: ujErr } = await admin
        .from('user_jurisdictions')
        .upsert(rows, { onConflict: 'user_id,jurisdiction_id' });
    if (ujErr) {
        return { ok: false, reason: `jurisdiction link failed: ${ujErr.message}` };
    }

    return { ok: true, userId, alreadyExisted };
}
