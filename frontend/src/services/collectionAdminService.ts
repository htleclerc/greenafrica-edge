import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BadgeVariant } from '@/lib/badgeUtils';

// La vue v_collection_admin n'est pas dans supabase.generated.ts ; client non typé
// pour le query builder (même patron que invoiceAdminService).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface CollectionAdminRow {
    transaction_id: string;
    invoice_ref: string | null;
    status: string;
    tax_amount_usd: number;
    outstanding_usd: number;
    created_at: string;
    shipowner_id: string | null;
    debtor_name: string | null;
    flag_country: string | null;
    jurisdiction_id: string | null;
    jurisdiction_code: string | null;
    jurisdiction_name: string | null;
    reminder_count: number;
    latest_tier: string | null;
    latest_sent_at: string | null;
    latest_response_type: string | null;
    latest_response_at: string | null;
}

export interface CollectionAdminFilters {
    q?: string;
    jurisdictionId?: string;
    status?: string;
    latestTier?: string;
    latestResponse?: string;
    page: number;
    pageSize: number;
}

export interface CollectionAdminPage {
    rows: CollectionAdminRow[];
    total: number;
    page: number;
    pageSize: number;
}

function first(v: string | string[] | undefined): string | undefined {
    return Array.isArray(v) ? v[0] : (v ?? undefined);
}

const filtersSchema = z.object({
    q: z.string().trim().min(1).optional().catch(undefined),
    jurisdictionId: z.string().trim().min(1).optional().catch(undefined),
    status: z.string().trim().min(1).optional().catch(undefined),
    latestTier: z.string().trim().min(1).optional().catch(undefined),
    latestResponse: z.string().trim().min(1).optional().catch(undefined),
    page: z.number().int().min(1).catch(1),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
});

export function parseCollectionFilters(
    sp: Record<string, string | string[] | undefined>,
): CollectionAdminFilters {
    const rawPage = Number.parseInt(first(sp.page) ?? '', 10);
    const rawSize = Number.parseInt(first(sp.pageSize) ?? '', 10);
    return filtersSchema.parse({
        q: first(sp.q),
        jurisdictionId: first(sp.jurisdictionId),
        status: first(sp.status),
        latestTier: first(sp.latestTier),
        latestResponse: first(sp.latestResponse),
        page: Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1,
        pageSize: Number.isFinite(rawSize) ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize)) : DEFAULT_PAGE_SIZE,
    });
}

function escapeSearch(q: string): string {
    return q.replace(/[%,()]/g, ' ');
}

interface RawRow { [k: string]: unknown }

function toRow(r: RawRow): CollectionAdminRow {
    return {
        transaction_id: String(r.transaction_id),
        invoice_ref: (r.invoice_ref as string | null) ?? null,
        status: String(r.status ?? ''),
        tax_amount_usd: Number(r.tax_amount_usd),
        outstanding_usd: Number(r.outstanding_usd),
        created_at: String(r.created_at),
        shipowner_id: (r.shipowner_id as string | null) ?? null,
        debtor_name: (r.debtor_name as string | null) ?? null,
        flag_country: (r.flag_country as string | null) ?? null,
        jurisdiction_id: (r.jurisdiction_id as string | null) ?? null,
        jurisdiction_code: (r.jurisdiction_code as string | null) ?? null,
        jurisdiction_name: (r.jurisdiction_name as string | null) ?? null,
        reminder_count: Number(r.reminder_count),
        latest_tier: (r.latest_tier as string | null) ?? null,
        latest_sent_at: (r.latest_sent_at as string | null) ?? null,
        latest_response_type: (r.latest_response_type as string | null) ?? null,
        latest_response_at: (r.latest_response_at as string | null) ?? null,
    };
}

export async function listCollectionsAdmin(
    db: Client,
    f: CollectionAdminFilters,
): Promise<CollectionAdminPage> {
    let q = db.from('v_collection_admin').select('*', { count: 'exact' });
    if (f.jurisdictionId) q = q.eq('jurisdiction_id', f.jurisdictionId);
    if (f.status) q = q.eq('status', f.status);
    if (f.latestTier) q = q.eq('latest_tier', f.latestTier);
    if (f.latestResponse) q = q.eq('latest_response_type', f.latestResponse);
    if (f.q) {
        const s = escapeSearch(f.q).trim();
        q = q.or(`invoice_ref.ilike.% ${s} %,debtor_name.ilike.% ${s} %`);
    }
    const offset = (f.page - 1) * f.pageSize;
    const { data, count, error } = await q
        .order('latest_sent_at', { ascending: false })
        .range(offset, offset + f.pageSize - 1);
    if (error) throw new Error(`listCollectionsAdmin: ${error.message}`);
    return {
        rows: ((data ?? []) as RawRow[]).map(toRow),
        total: count ?? 0,
        page: f.page,
        pageSize: f.pageSize,
    };
}

export async function listCollectionFilterOptions(
    db: Client,
): Promise<{ jurisdictions: { id: string; name: string }[] }> {
    const { data, error } = await db.from('jurisdictions').select('id, name').order('name', { ascending: true });
    if (error) throw new Error(`listCollectionFilterOptions: ${error.message}`);
    return { jurisdictions: ((data ?? []) as { id: string; name: string }[]).map((j) => ({ id: j.id, name: j.name })) };
}

/** Palier de relance → variante de badge. */
export function tierVariant(tier: string | null): BadgeVariant {
    switch (tier) {
        case 'J3':
        case 'J7':  return 'info';
        case 'J15': return 'warning';
        case 'J30': return 'overdue';
        case 'J45':
        case 'BAILIFF':
        case 'JUDICIAL': return 'critical';
        default: return 'draft';
    }
}

/** Réponse du débiteur → variante de badge. */
export function responseVariant(resp: string | null): BadgeVariant {
    switch (resp) {
        case 'PAID': return 'paid';
        case 'DISPUTE': return 'disputed';
        case 'REFUSED': return 'critical';
        case 'PAYMENT_PROMISE':
        case 'PARTIAL_PAYMENT': return 'warning';
        case 'ACKNOWLEDGE': return 'info';
        default: return 'draft'; // SILENT / null
    }
}
