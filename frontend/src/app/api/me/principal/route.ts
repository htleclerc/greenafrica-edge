// ─────────────────────────────────────────────────────────────────────────────
// GET /api/me/principal — resolve caller kind: 'operator' | 'staff'
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors the requirePrincipal() server-side guard but exposes only the
// principal kind to the client.  Used by DashboardSidebar to decide which nav
// to render (operator flat list vs staff RBAC tree) without leaking DB details.
//
// Resolution:
//   1. No session           → 401
//   2. shipowners row ACTIVE → { kind: 'operator' }
//   3. profiles row exists  → { kind: 'staff' }
//   4. Neither found        → { kind: 'staff' } (fail-safe; middleware handles
//      real auth enforcement — the sidebar just needs to pick the right nav)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normaliseOperatorModes, type OperatorMode } from '@/lib/auth/requirePrincipal';

export const dynamic = 'force-dynamic';

type PrincipalResponse =
    | { kind: 'operator'; modes: OperatorMode[] }
    | { kind: 'staff' };

export async function GET() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: shipowner } = await supabase
        .from('shipowners')
        .select('id, applicable_modes')
        .eq('profile_id', user.id)
        .eq('account_state', 'ACTIVE')
        .maybeSingle();

    if (shipowner) {
        const modes = normaliseOperatorModes(
            (shipowner as { applicable_modes: unknown }).applicable_modes,
        );
        return NextResponse.json({ kind: 'operator', modes } satisfies PrincipalResponse);
    }

    return NextResponse.json({ kind: 'staff' } satisfies PrincipalResponse);
}
