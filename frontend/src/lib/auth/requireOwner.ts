// ─────────────────────────────────────────────────────────────────────────────
// Server-side role enforcement helper for the shipowner portal.
// ─────────────────────────────────────────────────────────────────────────────
//
// Use at the top of EVERY /owner/* server component to assert the caller is
// an authenticated SHIPOWNER linked to a shipowners row in ACTIVE state.
//
// Differs from requireRole() in three ways:
//   1. Redirects to /login (the unified sign-in) on auth failure.
//   2. Returns the shipowner record alongside the user, so pages don't have
//      to re-query.
//   3. Asserts account_state='ACTIVE' — INVITED owners who haven't redeemed
//      their magic link yet are bounced.
//
// MEMBRES (mig 135)
// Résout aussi un MEMBRE invité d'un compte, avec la même préséance que
// current_shipowner_id() et requirePrincipal : la propriété d'abord. Le
// paramètre `privilege` exige une sous-permission ; `'holder'` réserve l'action
// au titulaire.
//
// Le refus est un `redirect`, pas un `{ ok: false }` : ces actions n'ont pas de
// chemin d'échec côté appelant — elles supposent depuis toujours qu'arriver ici
// vaut autorisation. Rendre une valeur les laisserait continuer sans droit.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { ShipownerListRow } from '@/services/shipownerService';
import type { OwnerPrivileges, PrivilegeKey } from '@/lib/auth/ownerPrivileges';
import { resolveOwnerAccount } from '@/lib/auth/resolveOwnerAccount';

export interface OwnerSession {
    userId: string;
    email: string;
    shipowner: ShipownerListRow;
    /** The operator's home jurisdiction (GreenGate v8, Model B). Pass to createTenantClient(). */
    jurisdictionId: string;
    /** Sous-permissions de l'appelant sur ce compte. Le titulaire les a toutes. */
    privileges: OwnerPrivileges;
    /** Vrai quand l'appelant est un membre invité, pas le titulaire. */
    isMember: boolean;
    supabase: SupabaseClient;
}

/**
 * Ce qu'une action exige de son appelant :
 *   - une sous-permission (`'canPay'`, `'canDispute'`, `'canManageVessels'`,
 *     `'canInvite'`) ;
 *   - `'holder'` pour ce qui n'appartient qu'au titulaire — l'identité légale
 *     de la société et ses coordonnees bancaires ne se delèguent pas par une
 *     case à cocher ;
 *   - rien, pour ce que tout membre peut faire.
 */
export type OwnerRequirement = PrivilegeKey | 'holder';

export async function requireOwner(requirement?: OwnerRequirement): Promise<OwnerSession> {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) redirect('/login');

    // Titulaire OU membre invité, avec la préséance de la base (mig 135).
    const account = await resolveOwnerAccount(supabase, user.id);
    if (!account) {
        // Either profile_id wasn't set (corrupt invite) or auth user has no
        // matching shipowner — log out and bounce.
        await supabase.auth.signOut();
        redirect('/login?error=no_owner_record');
    }
    const { shipowner, privileges, isMember } = account;

    if (shipowner.account_state !== 'ACTIVE') {
        // Invitation issued but never redeemed, or admin revoked access.
        // Sign out so refresh doesn't loop, then send to login with hint.
        await supabase.auth.signOut();
        redirect(`/login?error=state_${shipowner.account_state.toLowerCase()}`);
    }

    // Le droit exigé est vérifié APRES l'état du compte : un compte suspendu se
    // refuse pour tout le monde, avec le même message, avant toute question de
    // permission.
    if (requirement) {
        const granted = requirement === 'holder' ? !isMember : privileges[requirement];
        if (!granted) redirect('/owner/profile?error=forbidden');
    }

    return {
        userId: user.id,
        email: user.email ?? shipowner.official_email ?? '',
        shipowner: shipowner as unknown as ShipownerListRow,
        jurisdictionId: shipowner.jurisdiction_id,
        privileges,
        isMember,
        supabase,
    };
}
