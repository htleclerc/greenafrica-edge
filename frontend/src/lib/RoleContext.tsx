'use client';

import * as React from 'react';
import { UserRole, SecureUser, OperationalSite } from '@/types/secure';
import { TEST_PROFILES } from '@/mock/datas/testProfiles';
import { createClient } from '@/lib/supabase/client';

interface RoleContextValue {
    role: UserRole;
    user: SecureUser;
    isDemo: boolean;
    ready: boolean;
}

const RoleContext = React.createContext<RoleContextValue>({
    role: UserRole.PORT_OFFICER,
    user: TEST_PROFILES[0],
    isDemo: false,
    ready: false,
});

export function useRole(): RoleContextValue {
    return React.useContext(RoleContext);
}

/**
 * Resolves the current user session:
 * 1. Check if demo mode is active → use mock TEST_PROFILES
 * 2. Otherwise, check Supabase session → load real profile from DB
 * 3. Blocks rendering until resolved to avoid layout flash.
 */
export function RoleProvider({ children }: { children: React.ReactNode }) {
    const [ctx, setCtx] = React.useState<RoleContextValue>({
        role: UserRole.PORT_OFFICER,
        user: TEST_PROFILES[0],
        isDemo: false,
        ready: false,
    });

    React.useEffect(() => {
        async function resolve() {
            // 1) Check demo mode flags
            let demoActive = localStorage.getItem('demo_active');
            let demoRole   = localStorage.getItem('demo_role') as UserRole | null;

            if (!demoActive || !demoRole) {
                const cookieMap = Object.fromEntries(
                    document.cookie.split(';').map((c) => c.trim().split('='))
                );
                demoActive = cookieMap['demo_active'] ?? null;
                demoRole   = (cookieMap['demo_role'] ?? null) as UserRole | null;
            }

            if (demoActive === 'true' && demoRole) {
                const resolvedRole = Object.values(UserRole).includes(demoRole) ? demoRole : UserRole.PORT_OFFICER;
                const user = TEST_PROFILES.find((p) => p.role === resolvedRole) ?? TEST_PROFILES[0];
                setCtx({ role: resolvedRole, user, isDemo: true, ready: true });
                return;
            }

            // 2) Real auth: check Supabase session
            try {
                const supabase = createClient();
                const { data: { user: authUser } } = await supabase.auth.getUser();

                if (authUser) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', authUser.id)
                        .single();

                    if (profile) {
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
                        setCtx({ role: profile.role as UserRole, user, isDemo: false, ready: true });
                        return;
                    }
                }
            } catch {
                // Supabase call failed — fall through to default
            }

            // 3) Fallback: no session, no demo → default (middleware should redirect to /login)
            setCtx({ role: UserRole.PORT_OFFICER, user: TEST_PROFILES[0], isDemo: false, ready: true });
        }

        resolve();
    }, []);

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
