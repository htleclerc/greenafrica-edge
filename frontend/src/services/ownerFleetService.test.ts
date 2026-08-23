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
function supa(
    vessels: Record<string, unknown>[],
    txns: Record<string, unknown>[],
    payments: Record<string, unknown>[] = [],
) {
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
        from: (t: string) => {
            if (t === 'vessels') return make(vessels);
            if (t === 'payments') return make(payments);
            return make(txns);
        },
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
            supa([MAYAR], [{ id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, status: 'PENDING' }]),
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
            supa([MAYAR], [{ id: 'tx1', vessel_id: 'v1', tax_amount_usd: 28999.99, status: 'VOID' }]),
            'own-1',
        );
        expect(fleet[0]).toMatchObject({ invoiceCount: 0, canRemove: true, outstandingUsd: 0 });
    });

    it('ne compte dans le solde que ce qui reste dû', async () => {
        const fleet = await listOwnerFleet(
            supa([MAYAR], [
                { id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, status: 'PENDING' },
                { id: 'tx2', vessel_id: 'v1', tax_amount_usd: 10000, status: 'PAID' },
                { id: 'tx3', vessel_id: 'v1', tax_amount_usd: 5000, status: 'OVERDUE' },
            ]),
            'own-1',
        );
        // Trois factures vivantes, mais seuls PENDING et OVERDUE restent dus.
        expect(fleet[0].invoiceCount).toBe(3);
        expect(fleet[0].outstandingUsd).toBeCloseTo(73832, 2);
        expect(fleet[0].canRemove).toBe(false);
    });

    it('retranche les reglements partiels deja encaisses', async () => {
        // Cette ligne sommait le montant plein : un armateur ayant regle la
        // moitie d'une facture voyait sur son portail une dette superieure a
        // celle que son propre releve mensuel lui reclamait. Deux chiffres pour
        // une meme creance, dont un faux.
        const fleet = await listOwnerFleet(
            supa([MAYAR], [
                { id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, partial_paid_usd: 20000, status: 'PARTIALLY_PAID' },
            ]),
            'own-1',
        );
        expect(fleet[0].outstandingUsd).toBeCloseTo(48832, 2);
        expect(fleet[0].canRemove).toBe(false);
    });

    it('retranche un paiement confirme, la ou vit vraiment l encaissement', async () => {
        // En production, les 3 factures PARTIALLY_PAID portent
        // partial_paid_usd = 0 : la migration 089 gele la colonne et la 051 ne
        // l'ecrit jamais. Le reste du ne peut donc se lire que dans `payments`,
        // sans quoi la plateforme reclame a l'armateur une somme qu'il a deja
        // versee.
        const fleet = await listOwnerFleet(
            supa(
                [MAYAR],
                [{ id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, partial_paid_usd: 0, status: 'PARTIALLY_PAID' }],
                [{ transaction_id: 'tx1', amount_usd_minor: 2000000, status: 'CONFIRMED' }],
            ),
            'own-1',
        );
        expect(fleet[0].outstandingUsd).toBeCloseTo(48832, 2);
    });

    it('ignore un paiement qui n est pas confirme', async () => {
        // Un virement annonce mais non encaisse n'eteint aucune dette.
        const fleet = await listOwnerFleet(
            supa(
                [MAYAR],
                [{ id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, partial_paid_usd: 0, status: 'PENDING' }],
                [{ transaction_id: 'tx1', amount_usd_minor: 2000000, status: 'INITIATED' }],
            ),
            'own-1',
        );
        expect(fleet[0].outstandingUsd).toBeCloseTo(68832, 2);
    });

    it('signale une échéance dépassée, pas la simple existence d une dette', async () => {
        // C'est l'échéance qui décide de l'alarme à l'écran : une somme due
        // dans trois semaines ne se lit pas comme une somme en retard.
        const hier = new Date(Date.now() - 86_400_000).toISOString();
        const demain = new Date(Date.now() + 86_400_000).toISOString();

        const enRetard = await listOwnerFleet(
            supa([MAYAR], [{ id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, status: 'OVERDUE', due_date: hier }]),
            'own-1',
        );
        expect(enRetard[0].overdue).toBe(true);

        const dansLesTemps = await listOwnerFleet(
            supa([MAYAR], [{ id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, status: 'PENDING', due_date: demain }]),
            'own-1',
        );
        expect(dansLesTemps[0].overdue).toBe(false);
    });

    it('ne compte pas comme en retard une facture soldée dont l échéance est passée', async () => {
        // Sans cette garde, un navire à jour resterait teint en rouge à vie.
        const hier = new Date(Date.now() - 86_400_000).toISOString();
        const fleet = await listOwnerFleet(
            supa([MAYAR], [{ id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, status: 'PAID', due_date: hier }]),
            'own-1',
        );
        expect(fleet[0].overdue).toBe(false);
        expect(fleet[0].outstandingUsd).toBe(0);
    });

    it('marque le règlement partiel', async () => {
        const fleet = await listOwnerFleet(
            supa(
                [MAYAR],
                [{ id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, partial_paid_usd: 0, status: 'PARTIALLY_PAID', due_date: null }],
                [{ transaction_id: 'tx1', amount_usd_minor: 2000000, status: 'CONFIRMED' }],
            ),
            'own-1',
        );
        expect(fleet[0].partiallyPaid).toBe(true);
        expect(fleet[0].outstandingUsd).toBeCloseTo(48832, 2);
    });

    it('ne marque aucun règlement partiel sur une facture intacte', async () => {
        const fleet = await listOwnerFleet(
            supa([MAYAR], [{ id: 'tx1', vessel_id: 'v1', tax_amount_usd: 68832, status: 'PENDING', due_date: null }]),
            'own-1',
        );
        expect(fleet[0].partiallyPaid).toBe(false);
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
