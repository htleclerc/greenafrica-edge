import { describe, it, expect } from 'vitest';
import { confirmedPaidUsdByTransaction } from './confirmedPayments';

function supa(payments: Record<string, unknown>[], error: { message: string } | null = null) {
    let filtered = [...payments];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.in = (col: string, vals: unknown[]) => {
        filtered = filtered.filter((r) => vals.includes(r[col]));
        return chain;
    };
    chain.eq = (col: string, val: unknown) => {
        filtered = filtered.filter((r) => r[col] === val);
        return chain;
    };
    chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: error ? null : filtered, error }).then(res);
    return { from: () => chain } as never;
}

describe('confirmedPaidUsdByTransaction', () => {
    it('somme les paiements confirmes, en dollars', async () => {
        const paid = await confirmedPaidUsdByTransaction(
            supa([
                { transaction_id: 'tx1', amount_usd_minor: 1000000, status: 'CONFIRMED' },
                { transaction_id: 'tx1', amount_usd_minor: 205557, status: 'CONFIRMED' },
                { transaction_id: 'tx2', amount_usd_minor: 50000, status: 'CONFIRMED' },
            ]),
            ['tx1', 'tx2'],
        );
        expect(paid.get('tx1')).toBeCloseTo(12055.57, 2);
        expect(paid.get('tx2')).toBeCloseTo(500, 2);
    });

    it('ecarte tout ce qui n est pas CONFIRMED', async () => {
        // Un virement annonce, une capture en cours ou un paiement rejete
        // n'eteignent aucune dette.
        const paid = await confirmedPaidUsdByTransaction(
            supa([
                { transaction_id: 'tx1', amount_usd_minor: 1000000, status: 'INITIATED' },
                { transaction_id: 'tx1', amount_usd_minor: 1000000, status: 'REJECTED' },
                { transaction_id: 'tx1', amount_usd_minor: 1000000, status: 'REFUNDED' },
            ]),
            ['tx1'],
        );
        expect(paid.has('tx1')).toBe(false);
    });

    it('ignore un paiement sans facture rattachee', async () => {
        // Une alimentation de portefeuille porte transaction_id nul : elle
        // n'eteint pas une facture en particulier.
        const paid = await confirmedPaidUsdByTransaction(
            supa([{ transaction_id: null, amount_usd_minor: 500000, status: 'CONFIRMED' }]),
            ['tx1'],
        );
        expect(paid.size).toBe(0);
    });

    it('n interroge pas la base sans facture a couvrir', async () => {
        let called = false;
        const client = { from: () => { called = true; return {}; } } as never;
        expect((await confirmedPaidUsdByTransaction(client, [])).size).toBe(0);
        expect(called).toBe(false);
    });

    it('propage une erreur de lecture au lieu de rendre zero encaisse', async () => {
        // Rendre une carte vide sur echec ferait apparaitre la dette au montant
        // plein : un incident de lecture deviendrait une reclamation.
        await expect(
            confirmedPaidUsdByTransaction(supa([], { message: 'timeout' }), ['tx1']),
        ).rejects.toThrow(/timeout/);
    });
});
