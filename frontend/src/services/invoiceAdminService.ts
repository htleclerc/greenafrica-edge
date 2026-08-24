import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Constants, type Database } from '@/types/supabase.generated';

type Client = SupabaseClient<Database>;

type InvoiceRow = Database['public']['Views']['v_invoice_admin']['Row'];

// Ces trois listes se lisent sur la vue plutôt que d'être recopiées à la main :
// une valeur ajoutée en base arrive ici sans rien toucher, et une valeur
// inventée ne compile plus au lieu de ramener une page vide.
export type InvoiceStatus = NonNullable<InvoiceRow['status']>;
export type InvoiceDocumentType = Database['public']['Enums']['document_type'];
export type TransportMode = Database['public']['Enums']['transport_mode'];

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface InvoiceAdminFilters {
    documentType?: InvoiceDocumentType;
    mode?: TransportMode;
    status?: InvoiceStatus;
    jurisdictionId?: string;
    flagCountry?: string;
    dueOnly?: boolean;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    sortKey?: string;
    sortDir?: 'asc' | 'desc';
    page: number;
    pageSize: number;
}

/** Retient la première valeur d'un param (string | string[] | undefined). */
function first(v: string | string[] | undefined): string | undefined {
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
}

/** Colonnes triables. Toute clé absente d'ici retombe sur l'ordre par défaut. */
export const INVOICE_SORT_KEYS = [
    'invoice_ref', 'debtor_name', 'created_at', 'tax_amount_usd',
    'status', 'jurisdiction_name', 'document_type',
] as const;

const filtersSchema = z.object({
    documentType: z.enum(['PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND']).optional().catch(undefined),
    mode: z.enum(['MARITIME', 'AIR']).optional().catch(undefined),
    status: z.enum(Constants.public.Enums.transaction_status).optional().catch(undefined),
    jurisdictionId: z.string().trim().min(1).optional().catch(undefined),
    flagCountry: z.string().trim().min(1).optional().catch(undefined),
    dueOnly: z.boolean().catch(false),
    search: z.string().trim().min(1).optional().catch(undefined),
    dateFrom: z.string().regex(DATE_RE).optional().catch(undefined),
    dateTo: z.string().regex(DATE_RE).optional().catch(undefined),
    sortKey: z.enum(INVOICE_SORT_KEYS).optional().catch(undefined),
    sortDir: z.enum(['asc', 'desc']).optional().catch(undefined),
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
        sortKey: first(searchParams.sortKey),
        sortDir: first(searchParams.sortDir),
        page: Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1,
        pageSize: Number.isFinite(rawSize) ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize)) : DEFAULT_PAGE_SIZE,
    });

    return parsed;
}

export interface InvoiceAdminRow {
    id: string;
    invoice_ref: string | null;
    content_hash: string | null;
    verify_signature: string | null;
    document_type: InvoiceDocumentType;
    mode: TransportMode;
    status: string;
    tax_amount_usd: number;
    partial_paid_usd: number;
    outstanding_usd: number;
    created_at: string;
    due_date: string | null;
    paid_at: string | null;
    vessel_name: string;
    vessel_imo: string;
    shipowner_id: string | null;
    debtor_name: string | null;
    flag_country: string | null;
    jurisdiction_id: string;
    jurisdiction_code: string | null;
    jurisdiction_name: string | null;
    is_aviation: boolean;
}

export interface InvoiceAdminPage {
    rows: InvoiceAdminRow[];
    total: number;
    page: number;
    pageSize: number;
}

/** Échappe les caractères spéciaux d'un terme de recherche pour un filtre PostgREST `.or(ilike)`. */
function escapeSearch(q: string): string {
    return q.replace(/[%,()]/g, ' ');
}

function toRow(r: InvoiceRow): InvoiceAdminRow {
    return {
        id: String(r.id),
        invoice_ref: r.invoice_ref,
        content_hash: r.content_hash,
        verify_signature: r.verify_signature,
        document_type: r.document_type as InvoiceDocumentType,
        mode: r.mode as TransportMode,
        status: r.status ?? '',
        tax_amount_usd: Number(r.tax_amount_usd),
        partial_paid_usd: Number(r.partial_paid_usd),
        outstanding_usd: Number(r.outstanding_usd),
        created_at: String(r.created_at),
        due_date: r.due_date,
        paid_at: r.paid_at,
        vessel_name: String(r.vessel_name ?? ''),
        vessel_imo: String(r.vessel_imo ?? ''),
        shipowner_id: r.shipowner_id,
        debtor_name: r.debtor_name,
        flag_country: r.flag_country,
        jurisdiction_id: String(r.jurisdiction_id),
        jurisdiction_code: r.jurisdiction_code,
        jurisdiction_name: r.jurisdiction_name,
        is_aviation: Boolean(r.is_aviation),
    };
}

export async function listInvoicesAdmin(
    db: Client,
    filters: InvoiceAdminFilters,
): Promise<InvoiceAdminPage> {
    let q = db.from('v_invoice_admin').select('*', { count: 'exact' });

    if (filters.documentType) q = q.eq('document_type', filters.documentType);
    if (filters.mode) q = q.eq('mode', filters.mode);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.jurisdictionId) q = q.eq('jurisdiction_id', filters.jurisdictionId);
    if (filters.flagCountry) q = q.eq('flag_country', filters.flagCountry);
    if (filters.dueOnly) q = q.gt('outstanding_usd', 0);
    if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom);
    if (filters.dateTo) q = q.lte('created_at', `${filters.dateTo}T23:59:59.999Z`);
    if (filters.search) {
        const s = escapeSearch(filters.search);
        q = q.or(
            `invoice_ref.ilike.%${s}%,vessel_name.ilike.%${s}%,vessel_imo.ilike.%${s}%,debtor_name.ilike.%${s}%`,
        );
    }

    const offset = (filters.page - 1) * filters.pageSize;
    // Revalide au point d'usage : listInvoicesAdmin peut être appelée directement
    // (tests, futurs appelants) sans passer par parseInvoiceFilters. La liste blanche
    // doit donc tenir ici aussi, pas seulement en amont.
    const safeSortKey = filtersSchema.shape.sortKey.parse(filters.sortKey);
    const sortKey = safeSortKey ?? 'created_at';
    const ascending = safeSortKey ? filters.sortDir !== 'desc' : false;
    const { data, count, error } = await q
        .order(sortKey, { ascending })
        .order('id', { ascending: true }) // départage déterministe des égalités
        .range(offset, offset + filters.pageSize - 1);

    if (error) throw new Error(`listInvoicesAdmin: ${error.message}`);

    return {
        rows: (data ?? []).map(toRow),
        total: count ?? 0,
        page: filters.page,
        pageSize: filters.pageSize,
    };
}

export interface InvoiceFilterOptions {
    jurisdictions: { id: string; name: string }[];
    flagCountries: string[];
}

export async function listInvoiceFilterOptions(db: Client): Promise<InvoiceFilterOptions> {
    const { data: jData, error: jError } = await db
        .from('jurisdictions')
        .select('id, name')
        .order('name', { ascending: true });

    if (jError) throw new Error(`listInvoiceFilterOptions(jurisdictions): ${jError.message}`);

    const { data: fData, error: fError } = await db
        .from('v_invoice_admin')
        .select('flag_country');

    if (fError) throw new Error(`listInvoiceFilterOptions(flags): ${fError.message}`);

    const flagSet = new Set<string>();
    for (const row of (fData ?? []) as { flag_country: string | null }[]) {
        if (row.flag_country) flagSet.add(row.flag_country);
    }

    return {
        jurisdictions: ((jData ?? []) as { id: string; name: string }[]).map((j) => ({ id: j.id, name: j.name })),
        flagCountries: [...flagSet].sort(),
    };
}
