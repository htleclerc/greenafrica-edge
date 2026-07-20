import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

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
