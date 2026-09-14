import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAirlineDetail } from './airlineService';

describe('listAirlinesCockpit', () => {
    it('interroge la vue et normalise les nombres, tri dû décroissant', async () => {
        const chain = {
            select: vi.fn(() => chain),
            order: vi.fn(() => Promise.resolve({
                data: [{
                    id: 'a-1', name: 'Demo Airways', country_code: 'SO', account_state: 'GHOST',
                    is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false,
                    official_email: null, iata_code: 'DA', icao_code: 'DMO', hub_code: 'HGA', aoc_number: 'AOC-1',
                    proforma_count: '3', total_invoiced_usd: '1000.5', total_paid_usd: '400', total_outstanding_usd: '600.5',
                }],
                error: null,
            })),
        } as Record<string, unknown>;
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        const { listAirlinesCockpit } = await import('./airlineService');
        const rows = await listAirlinesCockpit(db);
        expect(db.from).toHaveBeenCalledWith('v_compagnie_recouvrement');
        expect(chain.order).toHaveBeenCalledWith('total_outstanding_usd', { ascending: false });
        expect(rows[0].proforma_count).toBe(3);
        expect(rows[0].total_outstanding_usd).toBe(600.5);
        expect(rows[0].iata_code).toBe('DA');
    });

    it('throw si la requête renvoie une erreur', async () => {
        const chain = {
            select: vi.fn(() => chain),
            order: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
        } as Record<string, unknown>;
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        const { listAirlinesCockpit } = await import('./airlineService');
        await expect(listAirlinesCockpit(db)).rejects.toThrow(/boom/);
    });
});

function detailDb(shipownerRow: Record<string, unknown> | null) {
    // Chaîne pour la requête shipowners : .select().eq().contains().maybeSingle()
    const soChain: Record<string, unknown> = {
        select: vi.fn(() => soChain),
        eq: vi.fn(() => soChain),
        contains: vi.fn(() => soChain),
        maybeSingle: vi.fn(() => Promise.resolve({ data: shipownerRow, error: null })),
    };
    // Chaîne générique pour aircraft/transactions/payments/collection_reminders
    const listChain = () => {
        const c: Record<string, unknown> = {
            select: vi.fn(() => c), eq: vi.fn(() => c), in: vi.fn(() => c),
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        };
        // certaines requêtes terminent sur .eq()/.in() sans .order() → rendre thenable
        (c as { then?: unknown }).then = undefined;
        return c;
    };
    const db = {
        from: vi.fn((t: string) => (t === 'shipowners' ? soChain : listChain())),
    } as unknown as SupabaseClient;
    return { db, soChain };
}

describe('getAirlineDetail', () => {
    it('renvoie null si la ligne ne porte pas le mode aérien (garde applicable_modes)', async () => {
        const { db, soChain } = detailDb(null);
        const res = await getAirlineDetail(db, 'x', true);
        expect(res).toBeNull();
        // La garde porte sur le mode, jamais sur le code IATA : une compagnie
        // sans code IATA reste une compagnie (mig 160).
        expect(soChain.contains).toHaveBeenCalledWith('applicable_modes', ['AIR']);
    });

    it('n’expose pas d’IBAN quand canViewBilling=false', async () => {
        const { db } = detailDb({
            id: 'a-1', name: 'Demo Airways', iata_code: 'DA', account_state: 'GHOST',
            is_ofac_sdn: false, is_un_prohibited: false, iban: 'ENCRYPTED',
        });
        const res = await getAirlineDetail(db, 'a-1', false);
        expect(res).not.toBeNull();
        expect(res?.iban_masked).toBeNull();
    });
});
