import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── Supabase browser client mock ────────────────────────────────────────────
// Chainable query builder whose terminal (single/maybeSingle) resolves per table.
function makeClient({
    user,
    profile,
    shipowner,
}: {
    user: { id: string; email?: string; last_sign_in_at?: string } | null;
    profile: Record<string, unknown> | null;
    shipowner: Record<string, unknown> | null;
}) {
    const builder = (result: { data: unknown; error: unknown }) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.single = () => Promise.resolve(result);
        b.maybeSingle = () => Promise.resolve(result);
        return b;
    };
    return {
        auth: { getUser: () => Promise.resolve({ data: { user } }) },
        from: (table: string) => {
            if (table === 'profiles')
                return builder({ data: profile, error: profile ? null : { message: 'no rows' } });
            if (table === 'shipowners') return builder({ data: shipowner, error: null });
            return builder({ data: null, error: null });
        },
    };
}

let mockClient: ReturnType<typeof makeClient>;
vi.mock('@/lib/supabase/client', () => ({ createClient: () => mockClient }));

import { RoleProvider, useRole, type InitialRolePrincipal } from '../RoleContext';
import { usePrincipalKind } from '@/hooks/usePrincipalKind';
import { UserRole, OperationalSite, type SecureUser } from '@/types/secure';

function Probe() {
    const { role, user, ready } = useRole();
    if (!ready) return <span>loading</span>;
    return <span data-testid="probe">{`${role}|${user.fullName}`}</span>;
}

function KindProbe() {
    const { kind, modes } = usePrincipalKind();
    return <span data-testid="kind">{`${kind}|${modes.join(',')}`}</span>;
}

describe('RoleProvider — operator (armateur) resolution', () => {
    beforeEach(() => {
        localStorage.clear();
        document.cookie = '';
    });

    it('resolves an operator (shipowners row, no profiles row) as SHIPPING_AGENT with the shipowner name — not the PORT_OFFICER test fallback', async () => {
        mockClient = makeClient({
            user: { id: 'op-uid-1', email: 'ops@mariner.example', last_sign_in_at: '2026-07-22T00:00:00Z' },
            profile: null, // operators have NO profiles row
            shipowner: {
                id: 'so-1',
                name: 'MARINER Corp',
                official_email: 'ops@mariner.example',
                account_state: 'ACTIVE',
                country_code: 'SO',
                profile_id: 'op-uid-1',
                applicable_modes: ['MARITIME'],
            },
        });

        render(
            <RoleProvider>
                <Probe />
            </RoleProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument());
        const text = screen.getByTestId('probe').textContent ?? '';
        expect(text).toContain(UserRole.SHIPPING_AGENT);
        expect(text).toContain('MARINER Corp');
        // Must NOT fall back to the staff sentinel.
        expect(text).not.toContain('Hassan');
        expect(text).not.toContain(UserRole.PORT_OFFICER);
    });
});

describe('RoleProvider — server-seeded principal (perf path)', () => {
    beforeEach(() => {
        localStorage.clear();
        document.cookie = '';
    });

    const operatorUser: SecureUser = {
        id: 'op-uid-2',
        email: 'ops@mariner.example',
        fullName: 'MARINER Corp',
        role: UserRole.SHIPPING_AGENT,
        operationalSite: OperationalSite.BERBERA_PORT,
        countryCode: 'SO',
        timezone: 'Africa/Mogadishu',
        preferredLanguage: 'en',
        lastLogin: '2026-07-22T00:00:00Z',
        ipAddress: '',
        isActive: true,
    };
    const initial: InitialRolePrincipal = {
        kind: 'operator',
        user: operatorUser,
        modes: ['MARITIME'],
    };

    it('paints immediately from the seed and performs NO client-side session round trip', async () => {
        const getUser = vi.fn();
        // Any client call would be a bug — fail loudly if the effect touches it.
        mockClient = { auth: { getUser }, from: () => { throw new Error('no client query when seeded'); } } as never;

        render(
            <RoleProvider initial={initial}>
                <Probe />
                <KindProbe />
            </RoleProvider>,
        );

        // Ready synchronously — the "loading" spinner must never show.
        expect(screen.getByTestId('probe').textContent).toBe('SHIPPING_AGENT|MARINER Corp');
        expect(screen.getByTestId('kind').textContent).toBe('operator|MARITIME');

        // Give any (erroneous) effect a tick to run, then assert no client calls.
        await waitFor(() => expect(getUser).not.toHaveBeenCalled());
    });
});
