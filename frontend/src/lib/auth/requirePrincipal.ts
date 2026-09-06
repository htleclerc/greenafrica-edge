// ─────────────────────────────────────────────────────────────────────────────
// Server-side guard that resolves the current principal as either an operator
// (shipowner) or a staff member, without requiring callers to know which kind
// of user they are dealing with.
//
// Resolution order:
//   1. If no session → redirect /login
//   2. If a shipowners row exists for this user (the account holder):
//        ACTIVE   → { kind: 'operator', privileges: all, ... }
//        otherwise → signOut + redirect /login?error=state_<state>
//   2b. Otherwise, if an ACTIVE owner_members row exists (mig 135), the user is
//       an invited member of someone else's account:
//        → { kind: 'operator', privileges: the flags they were granted }
//       Ownership is checked FIRST: accepting an invitation must never move an
//       account holder onto someone else's account.
//   3. If neither → resolve staff via profiles table:
//        profile missing   → redirect /login?error=no_profile
//        is_active = false → redirect /pending-approval
//        otherwise         → { kind: 'staff', ... }
//
// Intentionally does NOT restrict staff by role — callers that need RBAC should
// combine this with their own role check or use requireRole() directly.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { ShipownerListRow } from '@/services/shipownerService';
import { OperationalSite, UserRole, type SecureUser } from '@/types/secure';
import {
    OWNER_ALL_PRIVILEGES, privilegesFromMember, type OwnerPrivileges,
} from '@/lib/auth/ownerPrivileges';

/** Colonnes du compte armateur, lues à l'identique pour le titulaire et le membre. */
const SHIPOWNER_COLUMNS =
    'id, name, country_code, address, official_email, official_email_source, account_state, profile_id, imo_company_no, invited_at, kyc_level_c_completed_at, aoc_number, jurisdiction_id, applicable_modes';

// ── Discriminated union ───────────────────────────────────────────────────────

export type OperatorMode = 'MARITIME' | 'AIR';

/**
 * Vue « voir comme l'armateur » (staff, lecture seule). Absente pour un vrai
 * armateur. Les composants s'en servent pour désactiver les actions et lier
 * vers la vue admin plutôt que vers /dashboard.
 */
export interface OwnerViewAs {
    /** Préfixe des routes de la vue, ex. /admin/armateurs/arm_…/portail. */
    basePath: string;
    ownerRef: string;
    ownerName: string;
    /** Montants facturés visibles (FINANCE_ADMIN, SUPERADMIN, MANAGER). */
    canViewBilling: boolean;
    /** Portée réduite à un navire. */
    vessel?: { id: string; ref: string; name: string };
    /** Membre regardé (`?as=mbr_…`) : ses droits, pas ceux du titulaire. */
    member?: { ref: string; name: string | null; email: string | null };
    /** Suffixe de requête à reconduire sur chaque lien de la vue (`?as=…`). */
    query: string;
}

export type Principal =
    | {
          kind: 'operator';
          userId: string;
          email: string;
          shipowner: ShipownerListRow;
          /** The operator's home jurisdiction. Pass to createTenantClient(). */
          jurisdictionId: string;
          /** Modes this operator is allowed to act in. Defaults to ['MARITIME']. */
          applicableModes: OperatorMode[];
          /**
           * Sous-permissions sur ce compte (mig 135). Le titulaire les a toutes ;
           * un membre invité n'a que ce qui lui a été coché. Les écrans s'en
           * servent pour masquer une action ; le contrôle qui compte reste côté
           * action serveur et policy.
           */
          privileges: OwnerPrivileges;
          /** Vrai quand la personne est un membre invité, pas le titulaire. */
          isMember: boolean;
          supabase: SupabaseClient;
          /** Posé seulement par requireViewAsOwner : vue staff en lecture seule. */
          viewAs?: OwnerViewAs;
      }
    | {
          kind: 'staff';
          user: SecureUser;
          supabase: SupabaseClient;
      };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalises a raw `applicable_modes` value (text[] from Postgres) into a typed
 * OperatorMode[]. Filters out unknown values; falls back to ['MARITIME'] when the
 * column is null/empty so legacy maritime operators keep working unchanged.
 */
export function normaliseOperatorModes(raw: unknown): OperatorMode[] {
    if (!Array.isArray(raw)) return ['MARITIME'];
    const modes = raw.filter(
        (m): m is OperatorMode => m === 'MARITIME' || m === 'AIR',
    );
    return modes.length > 0 ? modes : ['MARITIME'];
}

// ── Guard ─────────────────────────────────────────────────────────────────────

export async function requirePrincipal(): Promise<Principal> {
    const supabase = await createClient();

    // 1. Resolve session.
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) redirect('/login');

    // 2. Attempt operator resolution.
    const { data: shipowner, error: shipownerError } = await supabase
        .from('shipowners')
        .select(SHIPOWNER_COLUMNS)
        .eq('profile_id', user.id)
        .maybeSingle();

    if (!shipownerError && shipowner) {
        if (shipowner.account_state !== 'ACTIVE') {
            await supabase.auth.signOut();
            redirect(`/login?error=state_${(shipowner.account_state as string).toLowerCase()}`);
        }

        const shipownerRow = shipowner as ShipownerListRow;
        const extra = shipowner as unknown as {
            jurisdiction_id: string;
            applicable_modes: unknown;
        };

        return {
            kind: 'operator',
            userId: user.id,
            email: user.email ?? shipowner.official_email ?? '',
            shipowner: shipownerRow,
            jurisdictionId: extra.jurisdiction_id,
            applicableModes: normaliseOperatorModes(extra.applicable_modes),
            privileges: OWNER_ALL_PRIVILEGES,
            isMember: false,
            supabase,
        };
    }

    // ── 2b. Membre invite d'un compte (mig 135) ──────────────────────────────
    // Teste APRES la propriété : accepter une invitation ne doit jamais déplacer
    // un titulaire sur le compte d'autrui. Meme préséance que
    // current_shipowner_id() côté base — les deux resolutions doivent repondre
    // la meme chose, sans quoi l'écran montrerait un compte et RLS un autre.
    const { data: membership } = await supabase
        .from('owner_members')
        .select('shipowner_id, can_pay, can_dispute, can_manage_vessels, can_invite')
        .eq('profile_id', user.id)
        .eq('active', true)
        .maybeSingle();

    if (membership) {
        const memberRow = membership as {
            shipowner_id: string;
            can_pay: boolean; can_dispute: boolean;
            can_manage_vessels: boolean; can_invite: boolean;
        };

        // RLS borne déjà `shipowners` a current_shipowner_id() : cette lecture
        // ne peut rendre que le compte dont la personne est membre.
        const { data: memberOwner } = await supabase
            .from('shipowners')
            .select(SHIPOWNER_COLUMNS)
            .eq('id', memberRow.shipowner_id)
            .maybeSingle();

        if (memberOwner) {
            // Un compte suspendu ferme la porte au membre comme au titulaire :
            // l'appartenance donne accès au compte, pas au-dela de son etat.
            if (memberOwner.account_state !== 'ACTIVE') {
                await supabase.auth.signOut();
                redirect(`/login?error=state_${(memberOwner.account_state as string).toLowerCase()}`);
            }

            const extraMember = memberOwner as unknown as {
                jurisdiction_id: string;
                applicable_modes: unknown;
            };

            return {
                kind: 'operator',
                userId: user.id,
                email: user.email ?? '',
                shipowner: memberOwner as ShipownerListRow,
                jurisdictionId: extraMember.jurisdiction_id,
                applicableModes: normaliseOperatorModes(extraMember.applicable_modes),
                privileges: privilegesFromMember(memberRow),
                isMember: true,
                supabase,
            };
        }
    }

    // 3. Staff resolution — re-fetch role from DB, never trust the JWT.
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select(
            'id, email, full_name, role, operational_site, country_code, timezone, preferred_language, is_active, ip_address',
        )
        .eq('id', user.id)
        .single();

    if (profileError || !profile) {
        redirect('/login?error=no_profile');
    }

    if (!profile.is_active) {
        redirect('/pending-approval');
    }

    const staffUser: SecureUser = {
        id: profile.id as string,
        email: profile.email as string,
        fullName: profile.full_name as string,
        role: profile.role as UserRole,
        operationalSite: (profile.operational_site as OperationalSite) ?? OperationalSite.BERBERA_PORT,
        countryCode: (profile.country_code as string) ?? 'SO',
        timezone: (profile.timezone as string) ?? 'Africa/Mogadishu',
        preferredLanguage: (profile.preferred_language as 'en' | 'fr' | 'pt' | 'sw' | 'ar' | 'so') ?? 'en',
        lastLogin: user.last_sign_in_at ?? '',
        ipAddress: (profile.ip_address as string) ?? '',
        isActive: profile.is_active as boolean,
    };

    return { kind: 'staff', user: staffUser, supabase };
}
