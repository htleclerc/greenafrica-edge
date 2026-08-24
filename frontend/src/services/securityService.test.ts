import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSecurityOverview } from './securityService';

type FactorRow = { id: string; status: string; friendly_name: string | null; created_at: string; updated_at: string };

function client(opts: {
    factors?: FactorRow[];
    factorsError?: boolean;
    sessions?: Record<string, unknown>[];
    sessionsError?: boolean;
}): SupabaseClient {
    return {
        auth: {
            mfa: {
                listFactors: vi.fn(async () =>
                    opts.factorsError
                        ? { data: null, error: { message: 'boom' } }
                        : { data: { totp: opts.factors ?? [], all: [] }, error: null }),
            },
        },
        rpc: vi.fn(async () =>
            opts.sessionsError
                ? { data: null, error: { message: 'boom' } }
                : { data: opts.sessions ?? [], error: null }),
    } as unknown as SupabaseClient;
}

const verified = (over: Partial<FactorRow> = {}): FactorRow => ({
    id: 'f1', status: 'verified', friendly_name: 'Green Gate TOTP',
    created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-02T11:00:00Z', ...over,
});

describe('loadSecurityOverview — ce que la page a le droit d’affirmer', () => {
    /**
     * L'écran annonçait « MFA activée » sur un compte sans facteur. La règle qui
     * l'empêche de recommencer : mfaEnabled se déduit des facteurs VÉRIFIÉS, et
     * ne vaut jamais vrai par défaut.
     */
    it('n’annonce la MFA que sur un facteur vérifié', async () => {
        const o = await loadSecurityOverview(client({ factors: [verified()] }));
        expect(o.mfaEnabled).toBe(true);
        expect(o.factors).toHaveLength(1);
    });

    it('ignore un enrôlement commencé puis abandonné', async () => {
        // Un facteur non vérifié ne protège rien : le téléphone n'a jamais
        // prouvé qu'il produisait le bon code.
        const o = await loadSecurityOverview(client({ factors: [verified({ status: 'unverified' })] }));
        expect(o.mfaEnabled).toBe(false);
        expect(o.factors).toEqual([]);
    });

    it('reste FAUX quand la lecture échoue — jamais vrai par défaut', async () => {
        const o = await loadSecurityOverview(client({ factorsError: true, sessionsError: true }));
        expect(o.mfaEnabled).toBe(false);
        expect(o.factors).toEqual([]);
        expect(o.sessions).toEqual([]);
    });

    it('date la protection à sa vérification, pas à l’ouverture du QR', async () => {
        const o = await loadSecurityOverview(client({ factors: [verified()] }));
        expect(o.factors[0].enrolledAt).toBe('2026-08-02T11:00:00Z');
    });
});

describe('loadSecurityOverview — les sessions', () => {
    const row = (over: Record<string, unknown> = {}) => ({
        id: 's1', created_at: '2026-08-20T08:00:00Z', refreshed_at: '2026-08-24T09:00:00Z',
        not_after: null, user_agent: 'Mozilla/5.0 Chrome/122', ip: '197.231.44.12',
        aal: 'aal1', is_current: false, ...over,
    });

    it('marque la session courante et celle qui a franchi le second facteur', async () => {
        const o = await loadSecurityOverview(client({
            sessions: [row({ is_current: true, aal: 'aal2' }), row({ id: 's2' })],
        }));
        expect(o.sessions[0]).toMatchObject({ isCurrent: true, elevated: true });
        expect(o.sessions[1]).toMatchObject({ isCurrent: false, elevated: false });
    });

    it('retombe sur la date de création quand la session n’a jamais été rafraîchie', async () => {
        // GoTrue ne date le rafraîchissement qu'au premier renouvellement.
        const o = await loadSecurityOverview(client({ sessions: [row({ refreshed_at: null })] }));
        expect(o.sessions[0].lastSeenAt).toBe('2026-08-20T08:00:00Z');
    });

    it('ne laisse jamais passer de matière rejouable', async () => {
        const o = await loadSecurityOverview(client({
            sessions: [{ ...row(), refresh_token_hmac_key: 'NE-DOIT-PAS-SORTIR' }],
        }));
        expect(JSON.stringify(o)).not.toContain('NE-DOIT-PAS-SORTIR');
    });
});
