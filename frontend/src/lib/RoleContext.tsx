'use client';

import * as React from 'react';
import { UserRole, SecureUser, OperationalSite } from '@/types/secure';
import { TEST_PROFILES } from '@/mock/datas/testProfiles';
import { createClient } from '@/lib/supabase/client';

export type PrincipalKind = 'operator' | 'staff';
export type OperatorMode = 'MARITIME' | 'AIR';

/** Server-resolved identity used to seed the provider (see getInitialPrincipal). */
export interface InitialRolePrincipal {
    kind: PrincipalKind;
    user: SecureUser;
    modes: OperatorMode[];
}

interface RoleContextValue {
    role: UserRole;
    user: SecureUser;
    isDemo: boolean;
    ready: boolean;
    /** operator (armateur) vs staff — the authoritative kind for chrome/nav. */
    kind: PrincipalKind;
    /** Modes an operator may act in; empty for staff. */
    modes: OperatorMode[];
}

const RoleContext = React.createContext<RoleContextValue>({
    role: UserRole.PORT_OFFICER,
    user: TEST_PROFILES[0],
    isDemo: false,
    ready: false,
    kind: 'staff',
    modes: [],
});

export function useRole(): RoleContextValue {
    return React.useContext(RoleContext);
}

function parseModes(raw: unknown): OperatorMode[] {
    if (!Array.isArray(raw)) return ['MARITIME'];
    const modes = raw.filter((m): m is OperatorMode => m === 'MARITIME' || m === 'AIR');
    return modes.length > 0 ? modes : ['MARITIME'];
}

type SupabaseBrowserClient = ReturnType<typeof createClient>;

const FALLBACK_CTX: RoleContextValue = {
    role: UserRole.PORT_OFFICER,
    user: TEST_PROFILES[0],
    isDemo: false,
    ready: true,
    kind: 'staff',
    modes: [],
};

function clearDemoFlags() {
    localStorage.removeItem('demo_active');
    localStorage.removeItem('demo_role');
    document.cookie = 'demo_active=; path=/; max-age=0';
    document.cookie = 'demo_role=; path=/; max-age=0';
}

/**
 * Client-side session resolution — the fallback path when the provider is NOT
 * seeded by the server (demo mode; or the provider used outside the dashboard
 * layout). For real dashboard sessions the server seeds `initial` and this never
 * runs. Kept operator-aware (defense in depth): an armateur has no `profiles`
 * row, only a `shipowners` row keyed by profile_id.
 */
async function resolveRealSession(
    supabase: SupabaseBrowserClient,
): Promise<RoleContextValue | null> {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return null;

    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

    if (profile) {
        clearDemoFlags();
        const user: SecureUser = {
            id: profile.id,
            email: profile.email,
            fullName: profile.full_name,
            role: profile.role as UserRole,
            operationalSite: (profile.operational_site as OperationalSite) ?? OperationalSite.BERBERA_PORT,
            countryCode: profile.country_code ?? 'SO',
            timezone: profile.timezone ?? 'Africa/Mogadishu',
            preferredLanguage: profile.preferred_language ?? 'en',
            lastLogin: authUser.last_sign_in_at ?? '',
            ipAddress: profile.ip_address ?? '',
            isActive: profile.is_active ?? true,
        };
        return { role: user.role, user, isDemo: false, ready: true, kind: 'staff', modes: [] };
    }

    const { data: shipowner } = await supabase
        .from('shipowners')
        .select('id, name, official_email, country_code, applicable_modes')
        .eq('profile_id', authUser.id)
        .eq('account_state', 'ACTIVE')
        .maybeSingle();

    if (shipowner) {
        clearDemoFlags();
        const user: SecureUser = {
            id: authUser.id,
            email: authUser.email ?? (shipowner.official_email as string) ?? '',
            fullName: (shipowner.name as string) ?? 'Operator',
            role: UserRole.SHIPPING_AGENT,
            operationalSite: OperationalSite.BERBERA_PORT,
            countryCode: (shipowner.country_code as string) ?? 'SO',
            timezone: 'Africa/Mogadishu',
            preferredLanguage: 'en',
            lastLogin: authUser.last_sign_in_at ?? '',
            ipAddress: '',
            isActive: true,
        };
        return {
            role: UserRole.SHIPPING_AGENT,
            user,
            isDemo: false,
            ready: true,
            kind: 'operator',
            modes: parseModes(shipowner.applicable_modes),
        };
    }

    return null;
}

function readDemoFlags(): { active: string | null; role: UserRole | null } {
    let active = localStorage.getItem('demo_active');
    let role = localStorage.getItem('demo_role') as UserRole | null;
    if (!active || !role) {
        const cookieMap = Object.fromEntries(
            document.cookie.split(';').map((c) => c.trim().split('=')),
        );
        active = cookieMap['demo_active'] ?? null;
        role = (cookieMap['demo_role'] ?? null) as UserRole | null;
    }
    return { active, role };
}

async function resolveDemo(
    supabase: SupabaseBrowserClient,
): Promise<RoleContextValue | null> {
    const { active, role } = readDemoFlags();
    if (active !== 'true' || !role) return null;

    if (process.env.NEXT_PUBLIC_DEMO_ALLOWED !== 'true') {
        clearDemoFlags();
        return null;
    }

    const { data: config } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'demo_mode')
        .single();
    const isRemoteEnabled = (config?.value as { enabled?: boolean } | null)?.enabled ?? true;
    if (!isRemoteEnabled) {
        clearDemoFlags();
        return null;
    }

    const resolvedRole = Object.values(UserRole).includes(role) ? role : UserRole.PORT_OFFICER;
    const user = TEST_PROFILES.find((p) => p.role === resolvedRole) ?? TEST_PROFILES[0];
    const kind: PrincipalKind = resolvedRole === UserRole.SHIPPING_AGENT ? 'operator' : 'staff';
    return {
        role: resolvedRole,
        user,
        isDemo: true,
        ready: true,
        kind,
        modes: kind === 'operator' ? ['MARITIME'] : [],
    };
}

/**
 * Resolves the current user session:
 * 1. If seeded by the server (`initial`) → use it, no client round trip.
 * 2. Else real Supabase session → load identity from DB (staff or operator).
 * 3. Else demo mode flags → mock TEST_PROFILES.
 * 4. Blocks rendering until resolved to avoid layout flash.
 */
export function RoleProvider({
    children,
    initial = null,
}: Readonly<{
    children: React.ReactNode;
    /**
     * Server-resolved principal (getInitialPrincipal). When provided, the chrome
     * paints immediately with the correct identity and no client-side session
     * round trip runs. Null only when there is no real session (demo mode), where
     * we fall back to client resolution below.
     */
    initial?: InitialRolePrincipal | null;
}>) {
    const [ctx, setCtx] = React.useState<RoleContextValue>(() =>
        initial
            ? {
                  role: initial.user.role,
                  user: initial.user,
                  isDemo: false,
                  ready: true,
                  kind: initial.kind,
                  modes: initial.modes,
              }
            : {
                  role: UserRole.PORT_OFFICER,
                  user: TEST_PROFILES[0],
                  isDemo: false,
                  ready: false,
                  kind: 'staff',
                  modes: [],
              },
    );

    React.useEffect(() => {
        // Server already resolved the principal — skip client-side resolution.
        if (initial) return;

        let cancelled = false;
        (async () => {
            const supabase = createClient();
            let next: RoleContextValue | null = null;
            try {
                next = await resolveRealSession(supabase);
            } catch {
                // Supabase call failed — fall through to demo / default.
            }
            next ??= await resolveDemo(supabase);
            if (!cancelled) setCtx(next ?? FALLBACK_CTX);
        })();

        return () => {
            cancelled = true;
        };
    }, [initial]);

    // Block rendering until role is resolved — avoids sidebar flash
    if (!ctx.ready) {
        return (
            <div
                style={{
                    backgroundColor: 'var(--os-bg)',
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <div
                        style={{
                            width: 32,
                            height: 32,
                            border: '3px solid var(--os-border)',
                            borderTopColor: '#10B981',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                        }}
                    />
                    <span style={{ color: 'var(--os-text-muted)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>
                        Initializing session…
                    </span>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            </div>
        );
    }

    return (
        <RoleContext.Provider value={ctx}>
            {children}
        </RoleContext.Provider>
    );
}
