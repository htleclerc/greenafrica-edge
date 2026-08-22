import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { UserRole, type SecureUser, OperationalSite } from '@/types/secure';

/**
 * Porte du rail monétaire : valider ou rejeter un encaissement.
 *
 * Deux façons d'y entrer, et une seule règle :
 *   - le rôle — SUPERADMIN ou FINANCE_ADMIN l'ont d'office ;
 *   - la sous-permission `profiles.can_settle_payments` (mig 130) — pour un
 *     MANAGER, dont le rôle ne doit pas changer : `profiles.role` est une
 *     colonne unique, le promouvoir FINANCE_ADMIN lui ferait perdre son vision
 *     board, et l'arbitrage recouvrement interdit d'élargir le rôle lui-même.
 *
 * Pourquoi un helper dédié plutôt qu'un `requireRole` élargi : beaucoup de
 * routes admin gatent sur [SUPERADMIN, FINANCE_ADMIN] sans rien avoir à voir
 * avec l'argent — remboursements, portefeuilles, paramètres fiscaux. Faire
 * porter la sous-permission par `requireRole` les ouvrirait toutes d'un coup.
 * Elle n'ouvre que les trois portes qui appellent explicitement cette fonction.
 *
 * Le drapeau est ADDITIF : le décocher sur un FINANCE_ADMIN ne lui retire rien.
 */

const SETTLEMENT_ROLES: readonly UserRole[] = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export interface SettlementRightsSuccess {
    user: SecureUser;
    supabase: SupabaseClient;
    error: null;
}

export interface SettlementRightsFailure {
    user: null;
    supabase: null;
    error: NextResponse;
}

export type SettlementRightsResult = SettlementRightsSuccess | SettlementRightsFailure;

/** Règle pure — réutilisable côté rendu pour afficher ou non une action. */
export function hasSettlementRights(
    profile: { role: UserRole | string; can_settle_payments?: boolean | null; is_active?: boolean | null },
): boolean {
    if (profile.is_active === false) return false;
    return (
        SETTLEMENT_ROLES.includes(profile.role as UserRole)
        || profile.can_settle_payments === true
    );
}

export async function requireSettlementRights(): Promise<SettlementRightsResult> {
    const supabase = await createClient();

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
        return { user: null, supabase: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    // Le profil est relu en base à chaque appel — jamais les claims du JWT, qui
    // restent périmés tant que la session n'a pas été rafraîchie.
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, operational_site, country_code, timezone, preferred_language, is_active, ip_address, can_settle_payments')
        .eq('id', authUser.id)
        .single();

    if (profileError || !profile) {
        return { user: null, supabase: null, error: NextResponse.json({ error: 'Forbidden — profile not found' }, { status: 403 }) };
    }
    if (!profile.is_active) {
        return { user: null, supabase: null, error: NextResponse.json({ error: 'Forbidden — account inactive' }, { status: 403 }) };
    }
    if (!hasSettlementRights(profile as { role: string; can_settle_payments: boolean | null; is_active: boolean })) {
        return {
            user: null,
            supabase: null,
            error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }),
        };
    }

    const user: SecureUser = {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        role: profile.role as UserRole,
        operationalSite: (profile.operational_site as OperationalSite) ?? OperationalSite.BERBERA_PORT,
        countryCode: profile.country_code ?? 'SO',
        timezone: profile.timezone ?? 'Africa/Mogadishu',
        preferredLanguage: (profile.preferred_language as SecureUser['preferredLanguage']) ?? 'en',
        lastLogin: authUser.last_sign_in_at ?? '',
        ipAddress: profile.ip_address ?? '',
        isActive: profile.is_active,
        canSettlePayments: profile.can_settle_payments === true,
    };

    return { user, supabase, error: null };
}
