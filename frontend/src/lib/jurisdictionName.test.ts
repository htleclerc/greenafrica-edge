import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    fetchJurisdictionMeta,
    fetchJurisdictionName,
    fetchJurisdictionBillingCc,
    fetchJurisdictionBailiffCc,
    _clearCacheForTest,
} from './jurisdictionName';

// ─────────────────────────────────────────────────────────────────────────────
// Stub Supabase minimal : .from(table).select(...).eq(...).maybeSingle().
// La ligne renvoyée dépend de la table demandée, pour tester la lecture
// jurisdictions (publique) et jurisdiction_billing_cc (privée) séparément.
// ─────────────────────────────────────────────────────────────────────────────

function clientReturning(
    byTable: Record<string, { data: Record<string, unknown> | null; error?: unknown }>,
) {
    return {
        from: (table: string) => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => byTable[table] ?? { data: null, error: null },
                }),
            }),
        }),
    } as unknown as SupabaseClient;
}

const djiboutiClient = clientReturning({
    jurisdictions: { data: { code: 'DJ', name: 'Republic of Djibouti' } },
});
const missingClient = clientReturning({ jurisdictions: { data: null } });
const errorClient = clientReturning({ jurisdictions: { data: null, error: { message: 'connection refused' } } });

beforeEach(() => {
    _clearCacheForTest();
});

describe('fetchJurisdictionMeta', () => {
    it('renvoie le code et le nom de la juridiction', async () => {
        await expect(fetchJurisdictionMeta(djiboutiClient, 'jur-dj')).resolves.toEqual({
            code: 'DJ',
            name: 'Republic of Djibouti',
        });
    });

    // Les lignes antérieures au multi-tenant (W2) n'ont pas de jurisdiction_id.
    it("retombe sur le Somaliland quand aucune juridiction n'est fournie", async () => {
        await expect(fetchJurisdictionMeta(missingClient, null)).resolves.toEqual({
            code: 'SO',
            name: 'Republic of Somaliland',
        });
    });

    it('retombe sur le Somaliland quand la requête échoue', async () => {
        const meta = await fetchJurisdictionMeta(errorClient, 'jur-x');
        expect(meta.code).toBe('SO');
    });
});

describe('fetchJurisdictionName', () => {
    it('renvoie le nom depuis la base sur un hit', async () => {
        await expect(fetchJurisdictionName(djiboutiClient, 'dj-uuid')).resolves.toBe('Republic of Djibouti');
    });

    it('retombe sur le fallback hérité quand jurisdictionId est null', async () => {
        await expect(fetchJurisdictionName(djiboutiClient, null)).resolves.toBe('Republic of Somaliland');
    });

    it('retombe sur le fallback hérité quand jurisdictionId est undefined', async () => {
        await expect(fetchJurisdictionName(djiboutiClient, undefined)).resolves.toBe('Republic of Somaliland');
    });

    it('retombe sur le fallback hérité quand la ligne est absente', async () => {
        await expect(fetchJurisdictionName(missingClient, 'unknown-id')).resolves.toBe('Republic of Somaliland');
    });

    it('retombe sur le fallback hérité sur erreur de base', async () => {
        await expect(fetchJurisdictionName(errorClient, 'some-id')).resolves.toBe('Republic of Somaliland');
    });

    it('utilise le cache mémoire au second appel (pas de seconde requête)', async () => {
        const querySpy = vi.fn().mockResolvedValue({ data: { code: 'DJ', name: 'Republic of Djibouti' }, error: null });
        const cachingClient = {
            from: () => ({ select: () => ({ eq: () => ({ maybeSingle: querySpy }) }) }),
        } as unknown as SupabaseClient;

        await fetchJurisdictionName(cachingClient, 'dj-cache-test');
        await fetchJurisdictionName(cachingClient, 'dj-cache-test');

        expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('rafraîchit le cache après expiration', async () => {
        const querySpy = vi.fn().mockResolvedValue({ data: { code: 'DJ', name: 'Republic of Djibouti' }, error: null });
        const cachingClient = {
            from: () => ({ select: () => ({ eq: () => ({ maybeSingle: querySpy }) }) }),
        } as unknown as SupabaseClient;

        _clearCacheForTest();
        await fetchJurisdictionName(cachingClient, 'ttl-test');
        expect(querySpy).toHaveBeenCalledTimes(1);

        _clearCacheForTest();
        await fetchJurisdictionName(cachingClient, 'ttl-test');
        expect(querySpy).toHaveBeenCalledTimes(2);
    });
});

describe('fetchJurisdictionBillingCc', () => {
    it('renvoie la liste des copies de la juridiction', async () => {
        const client = clientReturning({
            jurisdiction_billing_cc: { data: { cc_emails: ['finance@dj.gov', 'port@dj.gov'] } },
        });
        await expect(fetchJurisdictionBillingCc(client, 'jur-dj'))
            .resolves.toEqual(['finance@dj.gov', 'port@dj.gov']);
    });

    it("renvoie une liste vide quand aucune juridiction n'est fournie", async () => {
        await expect(fetchJurisdictionBillingCc(clientReturning({}), null)).resolves.toEqual([]);
    });

    // RLS : un client sans droit staff obtient zéro ligne, pas une erreur — on
    // traite donc l'absence comme « aucune copie », jamais comme un échec.
    it('renvoie une liste vide quand la ligne est introuvable ou filtrée par RLS', async () => {
        const client = clientReturning({ jurisdiction_billing_cc: { data: null } });
        await expect(fetchJurisdictionBillingCc(client, 'jur-dj')).resolves.toEqual([]);
    });

    it('renvoie une liste vide quand la requête échoue', async () => {
        const client = clientReturning({
            jurisdiction_billing_cc: { data: null, error: { message: 'boom' } },
        });
        await expect(fetchJurisdictionBillingCc(client, 'jur-dj')).resolves.toEqual([]);
    });
});

describe('fetchJurisdictionBailiffCc', () => {
    it('renvoie les copies huissier de la juridiction', async () => {
        const client = {
            from: () => ({ select: () => ({ eq: () => ({
                maybeSingle: async () => ({ data: { bailiff_cc_emails: ['huissier@eidle.so'] }, error: null }),
            }) }) }),
        } as unknown as SupabaseClient;
        await expect(fetchJurisdictionBailiffCc(client, 'jur-so')).resolves.toEqual(['huissier@eidle.so']);
    });

    it('renvoie une liste vide sans juridiction', async () => {
        const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } as unknown as SupabaseClient;
        await expect(fetchJurisdictionBailiffCc(client, null)).resolves.toEqual([]);
    });
});
