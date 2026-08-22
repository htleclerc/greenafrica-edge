import { describe, it, expect } from 'vitest';
import { withRunningBalances, computeProvision } from './walletProvision';
import type { LedgerRow } from './walletService';

const row = (id: string, createdAt: string, amountMinor: number): LedgerRow => ({
    id,
    wallet_id: 'w1',
    amount_signed_usd_minor: amountMinor,
    kind: amountMinor >= 0 ? 'TOPUP' : 'PROFORMA_APPLY',
    payment_id: null,
    transaction_id: null,
    refund_id: null,
    created_by: 'u1',
    justification: null,
    created_at: createdAt,
});

describe('withRunningBalances', () => {
    // Solde actuel $9 750 après : −$31 400 (12 août), +$15 000 (4 août), +$2 300 (21 juil.)
    const rows = [
        row('pay', '2026-08-12T10:00:00Z', -3_140_000),
        row('topup', '2026-08-04T10:00:00Z', 1_500_000),
        row('refund', '2026-07-21T10:00:00Z', 230_000),
    ];

    it('attribue le solde actuel au mouvement le plus récent', () => {
        const [latest] = withRunningBalances(rows, 975_000);
        expect(latest.id).toBe('pay');
        expect(latest.balanceAfterUsd).toBe(9_750);
    });
    it('remonte le temps en défaisant chaque mouvement', () => {
        const movements = withRunningBalances(rows, 975_000);
        expect(movements.map((m) => m.balanceAfterUsd)).toEqual([9_750, 41_150, 26_150]);
    });
    it('convertit les centimes en dollars, signe compris', () => {
        const movements = withRunningBalances(rows, 975_000);
        expect(movements.map((m) => m.amountUsd)).toEqual([-31_400, 15_000, 2_300]);
    });
    it('trie lui-même : un appelant qui inverse son ordre ne fausse pas les soldes', () => {
        const reversed = [...rows].reverse();
        expect(withRunningBalances(reversed, 975_000).map((m) => m.balanceAfterUsd))
            .toEqual([9_750, 41_150, 26_150]);
    });
    it('ne mute pas le tableau reçu', () => {
        const input = [...rows].reverse();
        withRunningBalances(input, 975_000);
        expect(input.map((r) => r.id)).toEqual(['refund', 'topup', 'pay']);
    });
    it('rend une liste vide sans mouvement', () => {
        expect(withRunningBalances([], 975_000)).toEqual([]);
    });
});

describe('computeProvision', () => {
    const prediction = { estimated_count_30d: 3, estimated_amount_30d_usd: 126_400, confidence: 'high' as const };

    it('chiffre l’écart entre les échéances à 30 jours et le solde', () => {
        const p = computeProvision(prediction, 9_750);
        expect(p.gapUsd).toBe(116_650);
        expect(p.short).toBe(true);
    });
    it('ne recommande rien quand le solde couvre déjà les échéances', () => {
        const p = computeProvision(prediction, 200_000);
        expect(p.gapUsd).toBe(0);
        expect(p.short).toBe(false);
    });
    it('ne rend jamais un écart négatif — un excédent n’est pas une provision', () => {
        expect(computeProvision(prediction, 1_000_000).gapUsd).toBe(0);
    });
    it('propage la confiance de la prévision, qui nuance la recommandation', () => {
        const p = computeProvision({ ...prediction, confidence: 'low' }, 0);
        expect(p.confidence).toBe('low');
        expect(p.estimatedCount).toBe(3);
    });
    it('ne recommande rien quand rien n’est prévu', () => {
        const p = computeProvision({ estimated_count_30d: 0, estimated_amount_30d_usd: 0, confidence: 'low' }, 0);
        expect(p.short).toBe(false);
    });
});
