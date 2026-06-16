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
export type OperatorMode = 'MARITIME' | 'AIR';

function parseModes(raw: unknown): OperatorMode[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((m): m is OperatorMode => m === 'MARITIME' || m === 'AIR');
}

export function usePrincipalKind(): { kind: PrincipalKind | null; modes: OperatorMode[] } {
    const [kind, setKind] = React.useState<PrincipalKind | null>(null);
    const [modes, setModes] = React.useState<OperatorMode[]>([]);

    React.useEffect(() => {
        let cancelled = false;
        fetch('/api/me/principal')
            .then((r) => r.json())
            .then((data: { kind?: PrincipalKind; modes?: unknown }) => {
                if (cancelled) return;
                if (data.kind === 'operator') {
                    setKind('operator');
                    setModes(parseModes(data.modes));
                } else {
                    setKind('staff');
                    setModes([]);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setKind('staff');
                    setModes([]);
                }
            });
        return () => { cancelled = true; };
    }, []);

    return { kind, modes };
}
