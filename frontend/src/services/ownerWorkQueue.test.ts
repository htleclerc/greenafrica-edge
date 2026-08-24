import { describe, it, expect } from 'vitest';
import {
    daysToDue, urgencyOf, sortWorkQueue, buildWorkQueue, splitActionBand, DUE_SOON_DAYS,
} from './ownerWorkQueue';

const NOW = new Date('2026-08-22T12:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

type Raw = Parameters<typeof buildWorkQueue>[0][number];

const raw: Raw = {
    id: 't1', invoice_ref: 'GG-2026-0418', vessel_name: 'MV BERBERA PRIDE',
    document_type: 'PROFORMA', tax_amount_usd: 48_200, partial_paid_usd: 0,
    due_date: inDays(-4), status: 'OVERDUE',
};

describe('daysToDue', () => {
    it('compte les jours restants avant l’échéance', () => {
        expect(daysToDue(inDays(9), NOW)).toBe(9);
    });
    it('rend un négatif sur une échéance dépassée', () => {
        expect(daysToDue(inDays(-4), NOW)).toBe(-4);
    });
    it('rend null sans échéance ou sur une date illisible', () => {
        expect(daysToDue(null, NOW)).toBeNull();
        expect(daysToDue('à l’escale', NOW)).toBeNull();
    });
});

describe('urgencyOf', () => {
    it('marque en retard dès que l’échéance est passée', () => {
        expect(urgencyOf(-1)).toBe('overdue');
    });
    it('marque échéance proche jusqu’au seuil des deux semaines inclus', () => {
        expect(urgencyOf(0)).toBe('dueSoon');
        expect(urgencyOf(DUE_SOON_DAYS)).toBe('dueSoon');
        expect(urgencyOf(DUE_SOON_DAYS + 1)).toBe('upcoming');
    });
    it('classe « à venir » une facture sans échéance — rien ne presse encore', () => {
        expect(urgencyOf(null)).toBe('upcoming');
    });
});

describe('sortWorkQueue', () => {
    const item = (id: string, days: number | null, amount = 1000) => ({
        transactionId: id, invoiceRef: null, vesselName: null, documentType: null,
        dueDate: null, daysToDue: days, amountUsd: amount, urgency: urgencyOf(days),
    });

    it('met le plus en retard en tête', () => {
        const sorted = sortWorkQueue([item('soon', 9), item('late', -4), item('later', 30)]);
        expect(sorted.map((i) => i.transactionId)).toEqual(['late', 'soon', 'later']);
    });
    it('renvoie les factures sans échéance en fin de file, par montant décroissant', () => {
        const sorted = sortWorkQueue([
            item('noDueSmall', null, 100),
            item('dated', 40),
            item('noDueBig', null, 900),
        ]);
        expect(sorted.map((i) => i.transactionId)).toEqual(['dated', 'noDueBig', 'noDueSmall']);
    });
    it('ne mute pas le tableau reçu', () => {
        const rows = [item('a', 40), item('b', -1)];
        sortWorkQueue(rows);
        expect(rows.map((i) => i.transactionId)).toEqual(['a', 'b']);
    });
});

describe('buildWorkQueue', () => {
    it('affiche le reste dû, pas le montant facturé', () => {
        const [item] = buildWorkQueue([{ ...raw, partial_paid_usd: 8_200 }], NOW);
        expect(item.amountUsd).toBe(40_000);
    });
    it("retranche l'encaissement confirmé, pas la colonne gelée", () => {
        // `partial_paid_usd` est gelée par la mig 089 et vaut zéro sur toute
        // facture en cours : le seul encaissement réel vient des paiements
        // CONFIRMED. S'y fier réclamait le montant plein à un armateur qui
        // avait déjà payé.
        const [item] = buildWorkQueue(
            [{ ...raw, partial_paid_usd: 0, confirmed_paid_usd: 8_200 }], NOW,
        );
        expect(item.amountUsd).toBe(40_000);
    });
    it('écarte une facture entièrement soldée par des acomptes', () => {
        expect(buildWorkQueue([{ ...raw, partial_paid_usd: 48_200 }], NOW)).toEqual([]);
    });
    it('ne rend jamais un reste dû négatif', () => {
        const [item] = buildWorkQueue([{ ...raw, partial_paid_usd: 60_000, tax_amount_usd: 48_200 }], NOW);
        expect(item).toBeUndefined();
    });
    it('normalise les montants rendus en chaînes par PostgREST', () => {
        const [item] = buildWorkQueue([{ ...raw, tax_amount_usd: '48200', partial_paid_usd: '200' }], NOW);
        expect(item.amountUsd).toBe(48_000);
    });
    it('classe la file et pose l’urgence de chaque ligne', () => {
        const queue = buildWorkQueue([
            { ...raw, id: 'soon', due_date: inDays(9) },
            { ...raw, id: 'late', due_date: inDays(-4) },
            { ...raw, id: 'far', due_date: inDays(60) },
        ], NOW);
        expect(queue.map((i) => [i.transactionId, i.urgency])).toEqual([
            ['late', 'overdue'],
            ['soon', 'dueSoon'],
            ['far', 'upcoming'],
        ]);
    });
});

describe('splitActionBand', () => {
    const item = (id: string, days: number | null) => ({
        transactionId: id, invoiceRef: null, vesselName: null, documentType: null,
        dueDate: null, daysToDue: days, amountUsd: 1000, urgency: urgencyOf(days),
    });

    it('donne la bande a la tete de file quand elle est en retard', () => {
        const { band, rows } = splitActionBand([item('late', -4), item('soon', 9)]);
        expect(band?.transactionId).toBe('late');
        expect(rows.map((r) => r.transactionId)).toEqual(['soon']);
    });
    it('ne donne la bande a personne si rien n’est en retard', () => {
        const queue = [item('soon', 9), item('far', 40)];
        const { band, rows } = splitActionBand(queue);
        expect(band).toBeNull();
        expect(rows).toHaveLength(2);
    });
    it('ne la donne qu’a un seul dossier, meme si plusieurs sont en retard', () => {
        const { band, rows } = splitActionBand([item('older', -30), item('late', -4)]);
        expect(band?.transactionId).toBe('older');
        expect(rows.map((r) => r.transactionId)).toEqual(['late']);
    });
    it('supporte une file vide', () => {
        expect(splitActionBand([])).toEqual({ band: null, rows: [] });
    });
});
