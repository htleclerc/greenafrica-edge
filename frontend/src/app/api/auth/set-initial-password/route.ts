// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/set-initial-password
// ─────────────────────────────────────────────────────────────────────────────
//
// Used by /auth/setup-password to let an authenticated user (typically just
// landed via an invitation magic link) overwrite their throwaway password
// with one of their own choosing.
//
// Auth: REQUIRES an existing Supabase session (cookies). No role check —
// any authenticated user can change their OWN password (Supabase
// auth.updateUser does the right thing under the user's session).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({
    password: z.string().min(8).max(128),
});

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'Password must be 8-128 characters' },
            { status: 400 },
        );
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // updateUser uses the caller's session — no service_role needed and the
    // user can only update themselves. This is the safe path.
    const { error: updateError } = await supabase.auth.updateUser({
        password: parsed.data.password,
    });

    if (updateError) {
        return NextResponse.json(
            { error: updateError.message || 'Password update failed' },
            { status: 500 },
        );
    }

    return NextResponse.json({ success: true });
}
