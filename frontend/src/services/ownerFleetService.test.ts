import { describe, it, expect } from 'vitest';
import { listOwnerFleet } from './ownerFleetService';

/**
 * Flotte de l'armateur de la session.
 *
 * `canRemove` est la garde métier de l'écran : un navire qui porte une facture
 * ne se retire pas en libre-service, il se conteste. Et depuis la rebascule du
 * livre, chaque navire du seed traîne une pro-forma ANNULÉE portant encore sa
 * référence — la compter bloquerait le retrait de navires qui ne doivent plus
 * rien.
 */
function supa(vessels: Record<string, unknown>[], txns: Record<string, unknown>[]) {
    const make = (rows: Record<string, unknown>[]) => {
        let filtered = [...rows];
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = (col: string, val: unknown) => {
            filtered = filtered.filter((r) => r[col] === val);
            return chain;
        };
        chain.in = (col: string, vals: unknown[]) => {
            filtered = filtered.filter((r) => vals.includes(r[col]));
            return chain;
        };
        chain.neq = (col: string, val: unknown) => {
            filtered = filtered.filter((r) => r[col] !== val);
            return chain;
        };
        chain.order = () => chain;
        // supabase-js resout la requete a l'await : le simulacre doit etre
        // thenable, pas une methode terminale.
        chain.then = (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: filtered, error: null }).then(res);
        return chain;
    };
    return {
        from: (t: string) => make(t === 'vessels' ? vessels : txns),
    } as never;
}

const MAYAR = {
    id: 'v1', name: 'MAYAR', imo_number: '9167057', mmsi: '341264001',
    flag_code: 'KN', compliance_status: 'PAYMENT_DUE', shipowner_id: 'own-1',
};
const VENIZ = {
    id: 'v2', name: 'VENIZ 1', imo_number: null, mmsi: null,
    flag_code: 'KM', compliance_status: 'PROCESSING', shipowner_id: 'own-1',
};

describe('listOwnerFleet', () => {
    it('interdit le retrait d’un navire facturé', async () => {
        const fleet = await listOwnerFleet(
            supa([MAYAR], [{ vessel_id: 'v1', tax_amount_usd: 68832, status: 'PENDING' }]),
            'own-1',
        );
        expect(fleet[0]).toMatchObject({ name: 'MAYAR', invoiceCount: 1, canRemove: false });
        expect(fleet[0].outstandingUsd).toBeCloseTo(68832, 2);
    });

    it('autorise le retrait d’un navire sans facture', async () => {
        const fleet = await listOwnerFleet(supa([VENIZ], []), 'own-1');
        expect(fleet[0]).toMatchObject({ invoiceCount: 0, canRemove: true, outstandingUsd: 0 });
    });

    it('ignore les factures annulées', async () => {
        // Sans ce filtre, la pro-forma du seed passée en VOID lors de la
        // rebascule bloquerait a vie le retrait du navire.
        const fleet = await listOwnerFleet(
            supa([MAYAR], [{ vessel_id: 'v1', tax_amount_usd: 28999.99, status: 'VOID' }]),
            'own-1',
        );
        expect(fleet[0]).toMatchObject({ invoiceCount: 0, canRemove: true, outstandingUsd: 0 });
    });

    it('ne compte dans le solde que ce qui reste dû', async () => {
        const fleet = await listOwnerFleet(
            supa([MAYAR], [
                { vessel_id: 'v1', tax_amount_usd: 68832, status: 'PENDING' },
                { vessel_id: 'v1', tax_amount_usd: 10000, status: 'PAID' },
                { vessel_id: 'v1', tax_amount_usd: 5000, status: 'OVERDUE' },
            ]),
            'own-1',
        );
        // Trois factures vivantes, mais seuls PENDING et OVERDUE restent dus.
        expect(fleet[0].invoiceCount).toBe(3);
        expect(fleet[0].outstandingUsd).toBeCloseTo(73832, 2);
        expect(fleet[0].canRemove).toBe(false);
    });

    it('rend une flotte vide sans interroger les factures', async () => {
        const fleet = await listOwnerFleet(supa([], []), 'own-inconnu');
        expect(fleet).toEqual([]);
    });

    it('n’expose que les navires de l’armateur de la session', async () => {
        const autre = { ...MAYAR, id: 'v9', name: 'AUTRE', shipowner_id: 'own-2' };
        const fleet = await listOwnerFleet(supa([MAYAR, autre], []), 'own-1');
        expect(fleet.map((v) => v.name)).toEqual(['MAYAR']);
    });

    it('accepte un navire sans IMO ni MMSI', async () => {
        const fleet = await listOwnerFleet(supa([VENIZ], []), 'own-1');
        expect(fleet[0]).toMatchObject({ imoNumber: null, mmsi: null, name: 'VENIZ 1' });
    });
});
