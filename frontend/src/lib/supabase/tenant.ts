/**
 * TenantScopedClient — the single sanctioned place to mint a service-role Supabase
 * client, and the security gate for GreenGate v8 multi-tenancy.
 *
 * Why this exists
 * ───────────────
 * Service-role clients bypass RLS. In a single-tenant world that was fine. In a
 * multi-tenant world, a service-role query that forgets `WHERE jurisdiction_id = …`
 * leaks one State's data to another — a sovereign data breach, not a bug. Several
 * tenant tables (wallets, wallet_ledger, refunds, owner_notifications) have RLS
 * ENABLED but ZERO policies, so RLS gives them no protection at all: the ONLY guard
 * is application code. This module makes the safe path the default and the unsafe
 * path conspicuous.
 *
 *   createTenantClient(jurisdictionId)  → auto-injects jurisdiction_id on every query
 *                                          against a tenant-scoped table. Use this by
 *                                          default in any request bound to one tenant.
 *   createPlatformClient()              → explicitly UNSCOPED service-role client.
 *                                          Use ONLY for control-plane work, crons that
 *                                          iterate jurisdictions, webhooks with no
 *                                          tenant context, and migrations. Conspicuous
 *                                          by name so reviewers can audit each use.
 *
 * An ESLint rule (eslint.config.mjs) bans raw `process.env.SUPABASE_SERVICE_ROLE_KEY`
 * usage outside this module, forcing all service-role access through these factories.
 *
 *   ┌───────────────────────── request bound to a tenant ─────────────────────────┐
 *   │  createTenantClient(jid).from('payments').select('*')                        │
 *   │    → base.from('payments').select('*').eq('jurisdiction_id', jid)            │
 *   │  createTenantClient(jid).from('profiles').select('*')   (not tenant-scoped)  │
 *   │    → base.from('profiles').select('*')        (passes through unchanged)     │
 *   └──────────────────────────────────────────────────────────────────────────────┘
 *
 * NOTE: .rpc() is NOT auto-scoped — an RPC that touches tenant tables must scope
 * itself in its own SQL. Storage/auth pass through. The scoping covers PostgREST
 * table access via .from(), which is where the leak risk lives.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Tables carrying a `jurisdiction_id` column that a tenant client filters on.
 *
 * Migrations 071 + 072 (aircraft from 074), then the child tables of mig 172.
 * On those nine, the database stamps the country from the parent row whatever
 * the caller sends; listing them here adds the read-side filter the
 * service-role client would otherwise skip.
 *
 * Not listed on purpose: control-plane tables (jurisdictions, tariffs,
 * revenue_split_rule, user_jurisdictions…), which staff screens read across
 * countries through the platform client, and `audit_logs`, whose column is
 * nullable — filtering it would hide the platform-level entries.
 */
export const TENANT_SCOPED_TABLES: ReadonlySet<string> = new Set([
    'transactions',
    'arrival_alerts',
    'vessels',
    'aircraft',
    'shipowners',
    'payments',
    'wallets',
    'wallet_ledger',
    'refunds',
    'owner_notifications',
    // mig 172
    'collection_reminders',
    'collections_event',
    'dispute_intervals',
    'disputes',
    'exemptions',
    'inspections',
    'owner_agent_mappings',
    'owner_members',
    'payment_proofs',
]);

const JURISDICTION_COL = 'jurisdiction_id';

type Row = Record<string, unknown>;
type InsertValues = Row | Row[];

interface FilterLike {
    eq: (column: string, value: unknown) => FilterLike;
}
interface QueryBuilderLike {
    select: (...args: unknown[]) => FilterLike;
    insert: (values: InsertValues, ...rest: unknown[]) => FilterLike;
    upsert: (values: InsertValues, ...rest: unknown[]) => FilterLike;
    update: (values: Row, ...rest: unknown[]) => FilterLike;
    delete: (...args: unknown[]) => FilterLike;
}

function rawServiceClient(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error(
            'TenantScopedClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
        );
    }
    return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * UNSCOPED service-role client. RLS-bypassing and NOT jurisdiction-filtered.
 * Use only for control-plane work, crons iterating jurisdictions, webhooks with no
 * tenant context, and migrations — each call site is audited.
 */
export function createPlatformClient(): SupabaseClient {
    return rawServiceClient();
}

function withJurisdiction(values: InsertValues, jid: string): InsertValues {
    // Force jurisdiction_id = jid (override any caller-supplied value) so a tenant
    // client can never insert into another tenant.
    return Array.isArray(values)
        ? values.map((v) => ({ ...v, [JURISDICTION_COL]: jid }))
        : { ...values, [JURISDICTION_COL]: jid };
}

function withoutJurisdiction(values: Row): Row {
    // Strip jurisdiction_id from update payloads so a tenant client can never move a
    // row to another tenant.
    if (values && typeof values === 'object' && !Array.isArray(values)) {
        const clone: Row = { ...values };
        delete clone[JURISDICTION_COL];
        return clone;
    }
    return values;
}

function scopedQueryBuilder(qb: QueryBuilderLike, jid: string): QueryBuilderLike {
    return {
        select: (...args) => qb.select(...args).eq(JURISDICTION_COL, jid),
        delete: (...args) => qb.delete(...args).eq(JURISDICTION_COL, jid),
        update: (values, ...rest) =>
            qb.update(withoutJurisdiction(values), ...rest).eq(JURISDICTION_COL, jid),
        insert: (values, ...rest) => qb.insert(withJurisdiction(values, jid), ...rest),
        upsert: (values, ...rest) => qb.upsert(withJurisdiction(values, jid), ...rest),
    };
}

/**
 * Service-role client scoped to one jurisdiction. Every `.from(table)` against a
 * tenant-scoped table is auto-filtered (reads/updates/deletes) and auto-stamped
 * (inserts/upserts) with `jurisdiction_id = jurisdictionId`.
 */
export function createTenantClient(jurisdictionId: string): SupabaseClient {
    if (!jurisdictionId) {
        throw new Error('createTenantClient: jurisdictionId is required');
    }
    const base = rawServiceClient();
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'from') {
                return (table: string) => {
                    const qb = target.from(table) as unknown as QueryBuilderLike;
                    return TENANT_SCOPED_TABLES.has(table)
                        ? scopedQueryBuilder(qb, jurisdictionId)
                        : qb;
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    }) as unknown as SupabaseClient;
}
