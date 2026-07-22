'use client';

// Operator vs staff is resolved server-side (getInitialPrincipal) and seeded into
// RoleContext, or resolved client-side by RoleProvider in demo mode. Either way
// the authoritative kind/modes live on RoleContext — this hook just reads them,
// so there is no extra /api/me/principal round trip on the dashboard critical
// path. `kind` is null only until the provider is ready (RoleProvider blocks its
// children on that, so consumers effectively always see a resolved kind).

import { useRole, type PrincipalKind, type OperatorMode } from '@/lib/RoleContext';

export type { PrincipalKind, OperatorMode };

export function usePrincipalKind(): { kind: PrincipalKind | null; modes: OperatorMode[] } {
    const { kind, modes, ready } = useRole();
    return { kind: ready ? kind : null, modes };
}
