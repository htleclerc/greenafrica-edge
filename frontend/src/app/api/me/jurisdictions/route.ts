// ─────────────────────────────────────────────────────────────────────────────
// GET /api/me/jurisdictions — list the caller's jurisdiction memberships
// ─────────────────────────────────────────────────────────────────────────────
//
// Returns the authenticated user's jurisdiction memberships plus the currently
// active jurisdiction (from the switcher cookie). Used by JurisdictionSwitcher
// to render the correct UI (static label vs dropdown).
//
// Response:
//   { memberships: [{ id, code, name }], active: string | null }
//
// RLS note: user_jurisdictions has row-level security; the session client can
// read the caller's own rows. The `jurisdictions` table has a read-all policy
// so the join works via the session client as well.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_JURISDICTION_COOKIE } from '@/lib/auth/tenantContext';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await createClient();
    const {
        data: { user },
    } = await session.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: rows, error } = await session
        .from('user_jurisdictions')
        .select('jurisdiction_id, jurisdictions(id, code, name)')
        .eq('user_id', user.id);

    if (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    type JurRow = {
        jurisdiction_id: string;
        jurisdictions: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null;
    };
    const memberships = ((rows as unknown as JurRow[]) ?? [])
        .flatMap((r) => {
            if (!r.jurisdictions) return [];
            const j = Array.isArray(r.jurisdictions) ? r.jurisdictions[0] : r.jurisdictions;
            if (!j) return [];
            return [{ id: j.id, code: j.code, name: j.name }];
        })
        // Sort deterministically by code so the auto-select on first login
        // always picks the same jurisdiction regardless of DB row order.
        .sort((a, b) => a.code.localeCompare(b.code));

    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(ACTIVE_JURISDICTION_COOKIE)?.value ?? null;
    const active = cookieValue && memberships.some((m) => m.id === cookieValue) ? cookieValue : null;

    return NextResponse.json({ memberships, active });
}
