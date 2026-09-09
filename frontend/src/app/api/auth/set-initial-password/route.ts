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
import { createPlatformClient } from '@/lib/supabase/tenant';

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

    // Cette route ne sert qu'UNE fois : celle où la personne n'a encore rien
    // choisi. Sans ce contrôle elle remplacerait n'importe quel mot de passe
    // sans prouver l'ancien, et la règle de la mig 137 — une session volée ne
    // suffit pas à verrouiller le titulaire hors de son compte — se
    // contournerait par un simple appel ici. Ensuite, c'est `changePassword`,
    // qui réclame l'ancien.
    const platform = createPlatformClient();
    const { data: profile } = await platform
        .from('profiles')
        .select('password_set_at')
        .eq('id', user.id)
        .maybeSingle();
    if ((profile as { password_set_at?: string | null } | null)?.password_set_at) {
        return NextResponse.json(
            { error: 'Password already set — use the account settings to change it.' },
            { status: 409 },
        );
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

    await platform.from('profiles')
        .update({ password_set_at: new Date().toISOString() })
        .eq('id', user.id);

    return NextResponse.json({ success: true });
}
