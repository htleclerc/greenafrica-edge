// ─────────────────────────────────────────────────────────────────────────────
// Server-side principal resolution for the dashboard *chrome* (name, role, skin,
// operator-vs-staff nav). Unlike requirePrincipal(), this NEVER redirects or
// signs out — route enforcement stays with middleware + each page's own
// requirePrincipal() guard. This exists so the (dashboard) layout can seed the
// client RoleProvider with the already-known identity, removing the client-side
// getUser()/profiles/shipowners round trips that used to block first paint.
//
// Per-request memoised via React cache(): the layout is the only caller today,
// but cache() keeps it free if a page resolves it too within the same request.
// ─────────────────────────────────────────────────────────────────────────────

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { normaliseOperatorModes, type OperatorMode } from '@/lib/auth/requirePrincipal';
import { OperationalSite, UserRole, type SecureUser } from '@/types/secure';

export type PrincipalKind = 'operator' | 'staff';

export interface InitialPrincipal {
    kind: PrincipalKind;
    user: SecureUser;
    modes: OperatorMode[];
}

async function _getInitialPrincipalImpl(): Promise<InitialPrincipal | null> {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // 1. Operator (armateur): lives only in `shipowners`, keyed by profile_id.
    const { data: shipowner } = await supabase
        .from('shipowners')
        .select('id, name, official_email, country_code, applicable_modes')
        .eq('profile_id', user.id)
        .eq('account_state', 'ACTIVE')
        .maybeSingle();

    if (shipowner) {
        const so = shipowner as {
            name: string;
            official_email: string | null;
            country_code: string | null;
            applicable_modes: unknown;
        };
        const operatorUser: SecureUser = {
            id: user.id,
            email: user.email ?? so.official_email ?? '',
            fullName: so.name ?? 'Operator',
            role: UserRole.SHIPPING_AGENT,
            operationalSite: OperationalSite.BERBERA_PORT,
            countryCode: so.country_code ?? 'SO',
            timezone: 'Africa/Mogadishu',
            preferredLanguage: 'en',
            lastLogin: user.last_sign_in_at ?? '',
            ipAddress: '',
            isActive: true,
        };
        return {
            kind: 'operator',
            user: operatorUser,
            modes: normaliseOperatorModes(so.applicable_modes),
        };
    }

    // 2. Staff: resolve from `profiles`.
    const { data: profile } = await supabase
        .from('profiles')
        .select(
            'id, email, full_name, role, operational_site, country_code, timezone, preferred_language, is_active, ip_address',
        )
        .eq('id', user.id)
        .single();

    if (!profile) return null;

    const staffUser: SecureUser = {
        id: profile.id as string,
        email: profile.email as string,
        fullName: profile.full_name as string,
        role: profile.role as UserRole,
        operationalSite: (profile.operational_site as OperationalSite) ?? OperationalSite.BERBERA_PORT,
        countryCode: (profile.country_code as string) ?? 'SO',
        timezone: (profile.timezone as string) ?? 'Africa/Mogadishu',
        preferredLanguage:
            (profile.preferred_language as 'en' | 'fr' | 'pt' | 'sw' | 'ar' | 'so') ?? 'en',
        lastLogin: user.last_sign_in_at ?? '',
        ipAddress: (profile.ip_address as string) ?? '',
        isActive: (profile.is_active as boolean) ?? true,
    };

    return { kind: 'staff', user: staffUser, modes: [] };
}

export const getInitialPrincipal = cache(_getInitialPrincipalImpl);
