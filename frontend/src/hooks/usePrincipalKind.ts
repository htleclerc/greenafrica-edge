'use client';

import * as React from 'react';

// Operator vs staff cannot be derived client-side from RoleContext: operators
// have no `profiles` row, so RoleContext falls back to its PORT_OFFICER
// sentinel — not reliable. GET /api/me/principal is the server-checked source
// (it inspects the `shipowners` table). While the fetch is in flight `kind` is
// null so consumers can render a neutral state and avoid a chrome flash.
// Error / network failure → assume 'staff' (safe: staff chrome never exposes
// operator-only data, and operator-only routes are notFound() for staff).

export type PrincipalKind = 'operator' | 'staff';

export function usePrincipalKind(): { kind: PrincipalKind | null } {
    const [kind, setKind] = React.useState<PrincipalKind | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        fetch('/api/me/principal')
            .then((r) => r.json())
            .then((data: { kind?: PrincipalKind }) => {
                if (!cancelled) setKind(data.kind === 'operator' ? 'operator' : 'staff');
            })
            .catch(() => {
                if (!cancelled) setKind('staff');
            });
        return () => { cancelled = true; };
    }, []);

    return { kind };
}
