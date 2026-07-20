import { describe, it, expect } from 'vitest';
import { parseInvoiceFilters } from './invoiceAdminService';

describe('parseInvoiceFilters', () => {
    it('applique les défauts page=1 pageSize=25 quand rien n’est fourni', () => {
        const f = parseInvoiceFilters({});
        expect(f.page).toBe(1);
        expect(f.pageSize).toBe(25);
        expect(f.documentType).toBeUndefined();
        expect(f.dueOnly).toBe(false);
    });

    it('clampe pageSize dans [1,100]', () => {
        expect(parseInvoiceFilters({ pageSize: '0' }).pageSize).toBe(1);
        expect(parseInvoiceFilters({ pageSize: '500' }).pageSize).toBe(100);
        expect(parseInvoiceFilters({ pageSize: '50' }).pageSize).toBe(50);
    });

    it('force page >= 1', () => {
        expect(parseInvoiceFilters({ page: '0' }).page).toBe(1);
        expect(parseInvoiceFilters({ page: '-3' }).page).toBe(1);
        expect(parseInvoiceFilters({ page: '4' }).page).toBe(4);
    });

    it('ignore une énumération invalide (documentType, mode)', () => {
        expect(parseInvoiceFilters({ documentType: 'BOGUS' }).documentType).toBeUndefined();
        expect(parseInvoiceFilters({ documentType: 'PROFORMA' }).documentType).toBe('PROFORMA');
        expect(parseInvoiceFilters({ mode: 'ROCKET' }).mode).toBeUndefined();
        expect(parseInvoiceFilters({ mode: 'AIR' }).mode).toBe('AIR');
    });

    it('interprète dueOnly', () => {
        expect(parseInvoiceFilters({ dueOnly: '1' }).dueOnly).toBe(true);
        expect(parseInvoiceFilters({ dueOnly: 'true' }).dueOnly).toBe(true);
        expect(parseInvoiceFilters({ dueOnly: '0' }).dueOnly).toBe(false);
        expect(parseInvoiceFilters({ dueOnly: 'no' }).dueOnly).toBe(false);
    });

    it('trim la recherche et traite le vide comme undefined', () => {
        expect(parseInvoiceFilters({ search: '  ABC ' }).search).toBe('ABC');
        expect(parseInvoiceFilters({ search: '   ' }).search).toBeUndefined();
    });

    it('valide les dates YYYY-MM-DD et rejette le reste', () => {
        expect(parseInvoiceFilters({ dateFrom: '2026-05-01' }).dateFrom).toBe('2026-05-01');
        expect(parseInvoiceFilters({ dateFrom: '01/05/2026' }).dateFrom).toBeUndefined();
        expect(parseInvoiceFilters({ dateTo: 'hier' }).dateTo).toBeUndefined();
    });

    it('prend la première valeur si le param est un tableau', () => {
        expect(parseInvoiceFilters({ mode: ['AIR', 'MARITIME'] }).mode).toBe('AIR');
    });
});
