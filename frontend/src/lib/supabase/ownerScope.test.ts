import { describe, it, expect, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock('@/lib/supabase/tenant', () => ({
    createTenantClient: () => ({ from: fromMock, auth: {}, rpc: vi.fn() }),
}));

import { createOwnerScopedClient } from './ownerScope';

/** Un builder qui note ses filtres : c'est tout ce qu'on veut vérifier. */
function builder() {
    const eqs: [string, unknown][] = [];
    const chain: Record<string, unknown> = {};
    chain.eq = (c: string, v: unknown) => { eqs.push([c, v]); return chain; };
    chain.select = () => chain;
    chain.insert = () => chain;
    return { chain, eqs };
}

const SCOPE = { jurisdictionId: 'jur-so', shipownerId: 'own-1' };

describe('createOwnerScopedClient', () => {
    it("borne les tables de l'armateur par shipowner_id, même sans filtre de l'appelant", () => {
        const b = builder();
        fromMock.mockReturnValue(b.chain);
        createOwnerScopedClient(SCOPE).from('transactions').select('id');
        expect(b.eqs).toEqual([['shipowner_id', 'own-1']]);
    });

    it("borne l'actif aérien par operator_id (mig 074)", () => {
        const b = builder();
        fromMock.mockReturnValue(b.chain);
        createOwnerScopedClient(SCOPE).from('aircraft').select('id');
        expect(b.eqs).toEqual([['operator_id', 'own-1']]);
    });

    it('ajoute la portée navire sur les tables qui le portent', () => {
        const b = builder();
        fromMock.mockReturnValue(b.chain);
        createOwnerScopedClient({ ...SCOPE, vesselId: 'v-1' }).from('transactions').select('id');
        expect(b.eqs).toEqual([['shipowner_id', 'own-1'], ['vessel_id', 'v-1']]);
    });

    it('borne la fiche navire par id en portée navire', () => {
        const b = builder();
        fromMock.mockReturnValue(b.chain);
        createOwnerScopedClient({ ...SCOPE, vesselId: 'v-1' }).from('vessels').select('id');
        expect(b.eqs).toEqual([['shipowner_id', 'own-1'], ['id', 'v-1']]);
    });

    it("refuse une table hors périmètre plutôt que de la laisser passer", () => {
        // Fermé par défaut : une table oubliée montrerait toute la juridiction
        // sous le nom d'un seul débiteur.
        fromMock.mockReturnValue(builder().chain);
        expect(() => createOwnerScopedClient(SCOPE).from('audit_logs')).toThrow(/hors de la portée/);
    });

    it("laisse passer les alertes d'arrivée seulement en portée navire", () => {
        fromMock.mockReturnValue(builder().chain);
        expect(() => createOwnerScopedClient(SCOPE).from('arrival_alerts')).toThrow(/hors de la portée/);
        const b = builder();
        fromMock.mockReturnValue(b.chain);
        createOwnerScopedClient({ ...SCOPE, vesselId: 'v-1' }).from('arrival_alerts').select('id');
        expect(b.eqs).toEqual([['vessel_id', 'v-1']]);
    });

    it('refuse toute écriture et tout rpc — voir n’est pas agir', () => {
        fromMock.mockReturnValue(builder().chain);
        const db = createOwnerScopedClient(SCOPE);
        const t = db.from('transactions') as unknown as Record<string, () => unknown>;
        expect(() => t.insert()).toThrow(/lecture seule/);
        expect(() => t.update()).toThrow(/lecture seule/);
        expect(() => t.upsert()).toThrow(/lecture seule/);
        expect(() => t.delete()).toThrow(/lecture seule/);
        expect(() => (db as unknown as { rpc: () => unknown }).rpc()).toThrow(/lecture seule/);
    });

    it('exige la juridiction et le compte', () => {
        expect(() => createOwnerScopedClient({ jurisdictionId: '', shipownerId: 'x' })).toThrow();
        expect(() => createOwnerScopedClient({ jurisdictionId: 'j', shipownerId: '' })).toThrow();
    });
});
