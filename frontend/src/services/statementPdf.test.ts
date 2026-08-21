import { describe, it, expect } from 'vitest';
import { generateStatementPdf, type StatementData } from './invoiceService';

const data: StatementData = {
    ownerName: 'Demo Armateur Ltd',
    jurisdiction: 'Republic of Djibouti',
    periodLabel: 'July 2026',
    openLines: [
        { transactionId: 'txn-aaaa', invoiceRef: 'PRO-2026-30-aaaa', vesselName: 'GG DEMO STAR', issuedAt: '2026-06-10', ageDays: 20, outstandingUsd: 16500 },
        { transactionId: 'txn-bbbb', invoiceRef: 'PRO-2026-30-bbbb', vesselName: 'GG DEMO PIONEER', issuedAt: '2026-06-14', ageDays: 16, outstandingUsd: 11492 },
    ],
    payments: [
        { confirmedAt: '2026-06-20', receiptRef: 'RCT-2026-0001', amountUsd: 5000 },
    ],
    totalOutstandingUsd: 27992,
    paymentsInMonthUsd: 5000,
};

describe('generateStatementPdf', () => {
    it('produit un PDF non vide', async () => {
        const buf = await generateStatementPdf(data);
        expect(buf).toBeInstanceOf(Uint8Array);
        expect(buf.byteLength).toBeGreaterThan(500);
        // en-tête PDF
        expect(String.fromCharCode(buf[0], buf[1], buf[2], buf[3])).toBe('%PDF');
    });

    it('ne plante pas sans paiements ni lignes ouvertes', async () => {
        const buf = await generateStatementPdf({ ...data, openLines: [], payments: [], totalOutstandingUsd: 0, paymentsInMonthUsd: 0 });
        expect(buf.byteLength).toBeGreaterThan(300);
    });
});
