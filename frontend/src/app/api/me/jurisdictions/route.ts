// ─────────────────────────────────────────────────────────────────────────────
// GET /api/me/jurisdictions — list the caller's jurisdiction memberships
// ─────────────────────────────────────────────────────────────────────────────
//
// Returns the authenticated user's jurisdiction memberships plus the currently
// active jurisdiction (from the switcher cookie). Used by JurisdictionSwitcher
// to render the correct UI (static label vs dropdown).
//
// Response:
//   { memberships: [{ id, code, name }], active: string | null, isGeneralAdmin: boolean }
//
// `memberships` garde son nom pour le sélecteur existant ; pour l'administrateur
// général, il porte TOUS les pays, auxquels il a accès sans y être rattaché.
//
// RLS note: user_jurisdictions has row-level security; the session client can
// read the caller's own rows. The `jurisdictions` table has a read-all policy
// so the join works via the session client as well.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_JURISDICTION_COOKIE } from '@/lib/auth/tenantContext';
import { listAccessibleJurisdictions, type JurisdictionRef } from '@/lib/auth/accessibleJurisdictions';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await createClient();
    const {
        data: { user },
    } = await session.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Tous les pays pour l'administrateur général, qui n'est rattaché à aucun ;
    // les rattachements pour le reste du personnel. Triés par code, pour que la
    // sélection automatique à la première connexion tombe toujours sur le même.
    let memberships: JurisdictionRef[];
    let isGeneralAdmin: boolean;
    try {
        const accessible = await listAccessibleJurisdictions(session, user.id);
        memberships = accessible.jurisdictions;
        isGeneralAdmin = accessible.isGeneralAdmin;
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(ACTIVE_JURISDICTION_COOKIE)?.value ?? null;
    const active = cookieValue && memberships.some((m) => m.id === cookieValue) ? cookieValue : null;

    return NextResponse.json({ memberships, active, isGeneralAdmin });
}
