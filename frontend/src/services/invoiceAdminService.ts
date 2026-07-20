import { z } from 'zod';

export type InvoiceDocumentType = 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND';
export type TransportMode = 'MARITIME' | 'AIR';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface InvoiceAdminFilters {
    documentType?: InvoiceDocumentType;
    mode?: TransportMode;
    status?: string;
    jurisdictionId?: string;
    flagCountry?: string;
    dueOnly?: boolean;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page: number;
    pageSize: number;
}

/** Retient la première valeur d'un param (string | string[] | undefined). */
function first(v: string | string[] | undefined): string | undefined {
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
}

const filtersSchema = z.object({
    documentType: z.enum(['PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND']).optional().catch(undefined),
    mode: z.enum(['MARITIME', 'AIR']).optional().catch(undefined),
    status: z.string().trim().min(1).optional().catch(undefined),
    jurisdictionId: z.string().trim().min(1).optional().catch(undefined),
    flagCountry: z.string().trim().min(1).optional().catch(undefined),
    dueOnly: z.boolean().catch(false),
    search: z.string().trim().min(1).optional().catch(undefined),
    dateFrom: z.string().regex(DATE_RE).optional().catch(undefined),
    dateTo: z.string().regex(DATE_RE).optional().catch(undefined),
    page: z.number().int().min(1).catch(1),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
});

export function parseInvoiceFilters(
    searchParams: Record<string, string | string[] | undefined>,
): InvoiceAdminFilters {
    const rawPage = Number.parseInt(first(searchParams.page) ?? '', 10);
    const rawSize = Number.parseInt(first(searchParams.pageSize) ?? '', 10);
    const dueRaw = first(searchParams.dueOnly);

    const parsed = filtersSchema.parse({
        documentType: first(searchParams.documentType),
        mode: first(searchParams.mode),
        status: first(searchParams.status),
        jurisdictionId: first(searchParams.jurisdictionId),
        flagCountry: first(searchParams.flagCountry),
        dueOnly: dueRaw === '1' || dueRaw === 'true',
        search: first(searchParams.search),
        dateFrom: first(searchParams.dateFrom),
        dateTo: first(searchParams.dateTo),
        page: Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1,
        pageSize: Number.isFinite(rawSize) ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize)) : DEFAULT_PAGE_SIZE,
    });

    return parsed;
}
