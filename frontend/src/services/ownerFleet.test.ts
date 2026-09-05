import { describe, it, expect } from 'vitest';
import { buildFleet, isInPort, matchesFleetTab } from './ownerFleet';

const NOW = new Date('2026-08-22T12:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

type RawVessel = Parameters<typeof buildFleet>[0][number];
type RawTxn = Parameters<typeof buildFleet>[1][number];

const vessel: RawVessel = {
    id: 'v1', public_ref: 'ves_0000000000a1', name: 'MV BERBERA PRIDE', imo_number: '9348576',
    category: 'BULK_CARRIER', last_zone: 'Quai 3 · Berbera', compliance_status: 'COMPLIANT',
};

const txn: RawTxn = {
    vessel_id: 'v1', vessel_imo: '9348576', tax_amount_usd: 48_200, partial_paid_usd: 0,
    emissions_tco2: 1_204, due_date: inDays(-4), document_type: 'FINAL', status: 'OVERDUE',
};

describe('isInPort', () => {
    it('reconnaît un quai et un port nommé', () => {
        expect(isInPort('Quai 3 · Berbera')).toBe(true);
        expect(isInPort('Port of Zeila')).toBe(true);
    });
    it('ne confond pas la haute mer avec une escale', () => {
        expect(isInPort("Golfe d'Aden")).toBe(false);
        expect(isInPort(null)).toBe(false);
    });
});

describe('buildFleet — reste dû', () => {
    it("retranche l'encaissement confirmé, pas la colonne gelée", () => {
        // Même règle que partout ailleurs : l'encaissement se lit dans les
        // paiements CONFIRMED, `partial_paid_usd` valant zéro sur toute
        // facture en cours (mig 089).
        const { vessels } = buildFleet(
            [vessel],
            [{ ...txn, id: 'tx1', partial_paid_usd: 0, confirmed_paid_usd: 5_000 }],
            [], NOW,
        );
        expect(vessels[0].outstandingUsd).toBe(Number(txn.tax_amount_usd) - 5_000);
    });
});

describe('buildFleet — statut', () => {
    it('marque en retard un navire dont l’échéance est passée', () => {
        const { vessels } = buildFleet([vessel], [txn], [], NOW);
        expect(vessels[0].status).toBe('overdue');
        expect(vessels[0].needsAction).toBe(true);
    });
    it('marque à payer une échéance encore à venir', () => {
        const { vessels } = buildFleet([vessel], [{ ...txn, due_date: inDays(9) }], [], NOW);
        expect(vessels[0].status).toBe('toPay');
        expect(vessels[0].urgency).toBe('dueSoon');
    });
    it('marque proforma une estimation sans échéance — ce n’est pas un retard', () => {
        const { vessels } = buildFleet([vessel], [{ ...txn, due_date: null, document_type: 'PROFORMA' }], [], NOW);
        expect(vessels[0].status).toBe('proforma');
        expect(vessels[0].needsAction).toBe(true);
    });
    it('marque conforme un navire qui ne doit rien, et le sort des cartes', () => {
        const { vessels } = buildFleet([vessel], [], [], NOW);
        expect(vessels[0].status).toBe('compliant');
        expect(vessels[0].needsAction).toBe(false);
    });
    it('l’exonération prime sur tout le reste', () => {
        const exempt = { ...vessel, compliance_status: 'EXEMPT' };
        const { vessels } = buildFleet([exempt], [txn], [], NOW);
        expect(vessels[0].status).toBe('exempt');
    });
});

describe('buildFleet — rapprochement des factures', () => {
    it('rattache par vessel_id quand il est posé', () => {
        const { vessels } = buildFleet([vessel], [txn], [], NOW);
        expect(vessels[0].outstandingUsd).toBe(48_200);
    });
    it('retombe sur l’IMO pour les factures antérieures au rattachement', () => {
        const orphan = { ...txn, vessel_id: null };
        const { vessels } = buildFleet([vessel], [orphan], [], NOW);
        expect(vessels[0].outstandingUsd).toBe(48_200);
    });
    it('ne compte pas deux fois une facture qui porte l’identifiant ET l’IMO', () => {
        const { vessels } = buildFleet([vessel], [txn], [], NOW);
        expect(vessels[0].outstandingUsd).toBe(48_200);
    });
    it('déduit les acomptes du reste dû', () => {
        const { vessels } = buildFleet([vessel], [{ ...txn, partial_paid_usd: 8_200 }], [], NOW);
        expect(vessels[0].outstandingUsd).toBe(40_000);
    });
    it('retient l’échéance la plus proche parmi les factures ouvertes', () => {
        const rows = [
            { ...txn, due_date: inDays(30) },
            { ...txn, due_date: inDays(3) },
        ];
        const { vessels } = buildFleet([vessel], rows, [], NOW);
        expect(vessels[0].daysToDue).toBe(3);
    });
    it('cumule les émissions des factures ouvertes', () => {
        const rows = [{ ...txn, emissions_tco2: 1_000 }, { ...txn, emissions_tco2: 204 }];
        expect(buildFleet([vessel], rows, [], NOW).vessels[0].emissionsTco2).toBe(1_204);
    });
    it('cumule le payé de l’année, id et IMO confondus', () => {
        const paid = [
            { ...txn, status: 'PAID', tax_amount_usd: 31_400 },
            { ...txn, status: 'PAID', vessel_id: null, tax_amount_usd: 10_000 },
        ];
        expect(buildFleet([vessel], [], paid, NOW).vessels[0].paidYtdUsd).toBe(41_400);
    });
});

describe('buildFleet — ordre et comptes', () => {
    const fleet = () => buildFleet(
        [
            { ...vessel, id: 'clean', name: 'ALPHA', imo_number: '1', last_zone: 'Mer Rouge' },
            { ...vessel, id: 'late', name: 'ZULU', imo_number: '2' },
            { ...vessel, id: 'soon', name: 'BRAVO', imo_number: '3', last_zone: "Golfe d'Aden" },
        ],
        [
            { ...txn, vessel_id: 'late', vessel_imo: '2', due_date: inDays(-4) },
            { ...txn, vessel_id: 'soon', vessel_imo: '3', due_date: inDays(9) },
        ],
        [],
        NOW,
    );

    it('place les navires à traiter en tête, le plus urgent d’abord', () => {
        expect(fleet().vessels.map((v) => v.id)).toEqual(['late', 'soon', 'clean']);
    });
    it('compte chaque onglet sur son propre critère', () => {
        const { counts } = fleet();
        expect(counts).toEqual({ all: 3, action: 2, inPort: 1, compliant: 1, exempt: 0 });
    });
    it('« Tous » ne filtre rien', () => {
        const v = fleet().vessels[0];
        expect(matchesFleetTab(v, 'all')).toBe(true);
    });
});
