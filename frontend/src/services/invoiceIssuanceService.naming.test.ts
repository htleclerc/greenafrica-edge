import { describe, it, expect } from 'vitest';
import { isoWeekNumber, mintInvoiceRef, buildStoragePath } from './invoiceIssuanceService';
import { parseInvoiceRef } from './invoiceService';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const TXN = '81be7109-0cca-4dc8-a077-eda4f4011570';

describe('isoWeekNumber', () => {
    // Valeurs calculées selon ISO 8601 : la semaine 1 est celle qui contient
    // le premier jeudi de l'année.
    it.each([
        ['2026-01-01', 1],   // jeudi — semaine 1
        ['2026-04-26', 17],
        ['2026-07-24', 30],
        ['2026-12-28', 53],  // 2026 est une année à 53 semaines
        ['2026-12-31', 53],
        ['2027-01-01', 53],  // vendredi — appartient encore à la semaine ISO 53 de 2026
        ['2027-01-03', 53],
        ['2027-01-04', 1],   // lundi — première semaine ISO de 2027
        ['2024-12-30', 1],   // lundi — première semaine ISO de 2025
        ['2025-01-01', 1],
    ])('%s tombe en semaine %i', (iso, expected) => {
        expect(isoWeekNumber(at(iso))).toBe(expected);
    });
});

describe('mintInvoiceRef', () => {
    it('produit PRO-<année civile>-<semaine ISO>-<12 hex> pour une pro-forma', () => {
        expect(mintInvoiceRef(TXN, 'proforma', at('2026-07-24')))
            .toMatch(/^PRO-2026-30-81be7109[0-9a-f]{4}$/);
    });

    it('produit le préfixe INV pour une facture', () => {
        expect(mintInvoiceRef(TXN, 'invoice', at('2026-07-24')))
            .toMatch(/^INV-2026-30-81be7109[0-9a-f]{4}$/);
    });

    it('pade la semaine sur deux chiffres', () => {
        expect(mintInvoiceRef(TXN, 'proforma', at('2026-01-01'))).toContain('-2026-01-');
    });

    // L'année reste l'année CIVILE, jamais l'année ISO : elle doit rester alignée
    // avec le dossier de stockage. Aux bornes, on accepte donc de lire une semaine
    // 53 dans une référence 2027.
    it("garde l'année civile même quand la semaine ISO appartient à l'année précédente", () => {
        expect(mintInvoiceRef(TXN, 'proforma', at('2027-01-01'))).toMatch(/^PRO-2027-53-/);
    });

    it("garde l'année civile même quand la semaine ISO appartient à l'année suivante", () => {
        expect(mintInvoiceRef(TXN, 'proforma', at('2024-12-30'))).toMatch(/^PRO-2024-01-/);
    });

    it("dérive la date du paramètre et non de l'horloge", () => {
        // Une créance de 2019 rattrapée aujourd'hui garde sa date d'origine.
        expect(mintInvoiceRef(TXN, 'proforma', at('2019-03-04'))).toMatch(/^PRO-2019-10-/);
    });

    it('reste lisible par parseInvoiceRef', () => {
        const ref = mintInvoiceRef(TXN, 'proforma', at('2026-07-24'));
        expect(parseInvoiceRef(ref)).toMatchObject({ type: 'PRO', year: 2026 });
    });

    it("varie d'un appel à l'autre pour rendre l'énumération infaisable", () => {
        const refs = new Set(
            Array.from({ length: 50 }, () => mintInvoiceRef(TXN, 'proforma', at('2026-07-24'))),
        );
        expect(refs.size).toBeGreaterThan(1);
    });
});

describe('buildStoragePath', () => {
    it('range une pro-forma sous <code>/proformas/<année>/<mois>', () => {
        expect(buildStoragePath({
            jurisdictionCode: 'SO',
            mode: 'proforma',
            createdAt: at('2026-07-24'),
            invoiceRef: 'PRO-2026-30-81be71091a2b',
        })).toBe('SO/proformas/2026/07/PRO-2026-30-81be71091a2b.pdf');
    });

    it('range une facture sous <code>/invoices/<année>/<mois>', () => {
        expect(buildStoragePath({
            jurisdictionCode: 'DJ',
            mode: 'invoice',
            createdAt: at('2026-11-03'),
            invoiceRef: 'INV-2026-45-200000007b95',
        })).toBe('DJ/invoices/2026/11/INV-2026-45-200000007b95.pdf');
    });

    // Les références déjà émises sont gelées en base et ne portent pas de semaine.
    // Elles doivent malgré tout se ranger correctement.
    it('range une référence héritée sans segment de semaine', () => {
        expect(buildStoragePath({
            jurisdictionCode: 'SO',
            mode: 'invoice',
            createdAt: at('2026-03-09'),
            invoiceRef: 'INV-2026-200000007b95',
        })).toBe('SO/invoices/2026/03/INV-2026-200000007b95.pdf');
    });

    it('pade le mois sur deux chiffres', () => {
        expect(buildStoragePath({
            jurisdictionCode: 'SO',
            mode: 'proforma',
            createdAt: at('2026-01-05'),
            invoiceRef: 'PRO-2026-02-aaaabbbbcccc',
        })).toContain('/2026/01/');
    });
});
