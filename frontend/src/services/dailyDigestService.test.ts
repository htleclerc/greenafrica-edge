import { describe, it, expect } from 'vitest';
import {
    buildDailyDigest,
    previousDayWindow,
    type PaymentRow,
    type ProformaRow,
} from './dailyDigestService';

const W = previousDayWindow(new Date('2026-09-13T06:00:00Z'));

function proforma(over: Partial<ProformaRow>): ProformaRow {
    return {
        invoice_ref: 'PRO-2026-064111',
        ref: 'INV-2026-000764',
        mode: 'MARITIME',
        vessel_name: 'TRUST 1',
        tax_amount_usd: 2821.2,
        proforma_sent_at: '2026-09-12T09:00:00Z',
        ...over,
    };
}

function payment(over: Partial<PaymentRow>): PaymentRow {
    return {
        receipt_ref: 'REC-2026-0001',
        amount_usd_minor: 250_000,
        rail: 'SWIFT',
        status: 'CONFIRMED',
        confirmed_at: '2026-09-12T10:00:00Z',
        created_at: '2026-09-12T08:00:00Z',
        ...over,
    };
}

describe('previousDayWindow', () => {
    // Une fenêtre glissante de 24 h ferait basculer un même envoi d'un
    // récapitulatif à l'autre selon les minutes de retard du cron.
    it('couvre le jour civil UTC précédent, bornes fermées', () => {
        const w = previousDayWindow(new Date('2026-09-13T06:17:42Z'));
        expect(w.startIso).toBe('2026-09-12T00:00:00.000Z');
        expect(w.endIso).toBe('2026-09-13T00:00:00.000Z');
        expect(w.label).toBe('2026-09-12');
    });

    it('ne dépend pas de l’heure du déclenchement', () => {
        const tot = previousDayWindow(new Date('2026-09-13T00:00:01Z'));
        const tard = previousDayWindow(new Date('2026-09-13T23:59:59Z'));
        expect(tot).toEqual(tard);
    });

    it('franchit correctement un changement de mois', () => {
        expect(previousDayWindow(new Date('2026-09-01T06:00:00Z')).label).toBe('2026-08-31');
    });
});

describe('buildDailyDigest — pro-formas', () => {
    it('sépare le maritime de l’aérien et totalise chaque mode', () => {
        const d = buildDailyDigest(
            W,
            [
                proforma({ mode: 'MARITIME', tax_amount_usd: 2821.2 }),
                proforma({ mode: 'AIR', tax_amount_usd: 560, vessel_name: 'ET-309' }),
                proforma({ mode: 'AIR', tax_amount_usd: 1040, vessel_name: 'FZ-501' }),
            ],
            [],
        );
        expect(d.maritime.count).toBe(1);
        expect(d.maritime.totalUsd).toBe(2821.2);
        expect(d.air.count).toBe(2);
        expect(d.air.totalUsd).toBe(1600);
        expect(d.issuedCount).toBe(3);
        expect(d.issuedTotalUsd).toBe(4421.2);
    });

    // « Envoyée » et « enregistrée » sont deux choses distinctes : les 41 lignes
    // versées le 10 septembre sont en base sans avoir été notifiées.
    it('ignore une pro-forma enregistrée mais jamais envoyée', () => {
        const d = buildDailyDigest(W, [proforma({ proforma_sent_at: null })], []);
        expect(d.issuedCount).toBe(0);
        expect(d.empty).toBe(true);
    });

    it('ne perd jamais une ligne dont le mode est vide', () => {
        const d = buildDailyDigest(W, [proforma({ mode: null })], []);
        expect(d.maritime.count).toBe(1);
        expect(d.issuedCount).toBe(1);
    });

    it('retombe sur la référence interne quand la référence pro-forma manque', () => {
        const d = buildDailyDigest(W, [proforma({ invoice_ref: null })], []);
        expect(d.maritime.lines[0].ref).toBe('INV-2026-000764');
    });

    it('classe du plus récent au plus ancien', () => {
        const d = buildDailyDigest(
            W,
            [
                proforma({ invoice_ref: 'A', proforma_sent_at: '2026-09-12T08:00:00Z' }),
                proforma({ invoice_ref: 'B', proforma_sent_at: '2026-09-12T20:00:00Z' }),
            ],
            [],
        );
        expect(d.maritime.lines.map((l) => l.ref)).toEqual(['B', 'A']);
    });

    it('le total est exactement la somme des lignes affichées', () => {
        const montants = [1234.56, 78.9, 0.01, 99999.99];
        const d = buildDailyDigest(W, montants.map((m) => proforma({ tax_amount_usd: m })), []);
        const somme = d.maritime.lines.reduce((a, l) => a + l.amountUsd, 0);
        expect(d.maritime.totalUsd).toBe(Math.round(somme * 100) / 100);
        expect(d.maritime.totalUsd).toBe(101313.46);
    });
});

describe('buildDailyDigest — paiements', () => {
    it('convertit les centimes en dollars', () => {
        const d = buildDailyDigest(W, [], [payment({ amount_usd_minor: 250_000 })]);
        expect(d.payments.totalUsd).toBe(2500);
    });

    // Une déclaration n'est pas un encaissement. Mais la taire laisserait
    // croire que rien n'arrive, alors qu'elle attend un traitement.
    it('sépare les paiements confirmés des déclarations en attente', () => {
        const d = buildDailyDigest(W, [], [
            payment({ status: 'CONFIRMED', amount_usd_minor: 100_000 }),
            payment({ status: 'INITIATED', amount_usd_minor: 50_000, confirmed_at: null }),
            payment({ status: 'PROCESSING', amount_usd_minor: 25_000, confirmed_at: null }),
        ]);
        expect(d.payments.count).toBe(1);
        expect(d.payments.totalUsd).toBe(1000);
        expect(d.pendingPayments.count).toBe(2);
        expect(d.pendingPayments.totalUsd).toBe(750);
    });

    it('ne compte ni les rejets, ni les annulations, ni les remboursements', () => {
        const d = buildDailyDigest(W, [], [
            payment({ status: 'REJECTED' }),
            payment({ status: 'CANCELLED' }),
            payment({ status: 'REFUNDED' }),
        ]);
        expect(d.payments.count).toBe(0);
        expect(d.pendingPayments.count).toBe(0);
        expect(d.empty).toBe(true);
    });
});

describe('buildDailyDigest — journée vide', () => {
    // Le récapitulatif part quand même : un message qui n'arrive qu'en cas
    // d'activité ne distingue pas « rien n'a bougé » de « la tâche est morte ».
    it('marque la journée vide sans rien inventer', () => {
        const d = buildDailyDigest(W, [], []);
        expect(d.empty).toBe(true);
        expect(d.issuedCount).toBe(0);
        expect(d.issuedTotalUsd).toBe(0);
        expect(d.payments.totalUsd).toBe(0);
    });

    it('une seule déclaration en attente suffit à ce que la journée ne soit pas vide', () => {
        const d = buildDailyDigest(W, [], [payment({ status: 'INITIATED', confirmed_at: null })]);
        expect(d.empty).toBe(false);
    });
});
