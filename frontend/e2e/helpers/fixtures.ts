/**
 * E2E fixtures — seed factories for the hosted Supabase test runs.
 *
 * Each factory:
 *   - Uses the service-role client to bypass RLS
 *   - Sets all NOT NULL columns explicitly (see MEMORY.md "Schema / DB"
 *     gotchas — transactions requires vessel_id/vessel_name/vessel_imo/
 *     emissions_tco2/tax_amount_usd; vessels requires
 *     mmsi/call_sign/flag_code/category/gross_tonnage_dwt/engine_power_kw/
 *     design_speed_knots)
 *   - Returns the inserted row's id + the key fields tests need
 *   - Prefixes string fields with `e2e-{timestamp}-{nanoid}` for traceability
 *     so a weekly orphan-data sweep query can find them.
 */

import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
        '[e2e/fixtures] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
    );
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

/** Unique tag for test data: `e2e-{epoch_ms}-{hex8}`. */
export function uniqueTag(): string {
    return `e2e-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

export function fakeImo(prefix: string = '99'): string {
    const tailLength = 7 - prefix.length;
    const tail = randomBytes(3).readUIntBE(0, 3).toString().padStart(7, '0').slice(-tailLength);
    return `${prefix}${tail}`;
}


// ─────────────────────────────────────────────────────────────────────────────
// shipowners
// ─────────────────────────────────────────────────────────────────────────────

export type ShipownerState =
    | 'GHOST'
    | 'PENDING_REVIEW'
    | 'INVITED'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'REJECTED';

export interface TestShipowner {
    id: string;
    imoCompanyNo: string;
    name: string;
    officialEmail: string;
    state: ShipownerState;
}

export async function seedShipowner(opts: {
    state?: ShipownerState;
    imoCompanyNo?: string;
    name?: string;
    officialEmail?: string;
} = {}): Promise<TestShipowner> {
    const tag = uniqueTag();
    const id = randomUUID();
    const row = {
        id,
        imo_company_no: opts.imoCompanyNo ?? fakeImo('9'),
        name: opts.name ?? `${tag}-shipowner`,
        official_email: opts.officialEmail ?? `${tag}@e2e-test.com`,
        account_state: opts.state ?? 'GHOST',
    };
    const { error } = await admin.from('shipowners').insert(row);
    if (error) throw new Error(`[e2e/fixtures] seedShipowner failed: ${error.message}`);
    return {
        id,
        imoCompanyNo: row.imo_company_no,
        name: row.name,
        officialEmail: row.official_email,
        state: row.account_state as ShipownerState,
    };
}

export async function deleteShipowner(id: string): Promise<void> {
    const { error } = await admin.from('shipowners').delete().eq('id', id);
    if (error) console.warn(`[e2e/fixtures] deleteShipowner(${id}) warning: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// vessels
// ─────────────────────────────────────────────────────────────────────────────

export interface TestVessel {
    id: string;
    imoNumber: string;
    name: string;
    shipownerId: string | null;
}

export async function seedVessel(opts: {
    shipownerId?: string;
    imoNumber?: string;
    name?: string;
} = {}): Promise<TestVessel> {
    const tag = uniqueTag();
    const id = randomUUID();
    const imo = opts.imoNumber ?? fakeImo('9');
    const row = {
        id,
        imo_number: imo,
        mmsi: `9${randomBytes(3).readUIntBE(0, 3).toString().padStart(8, '0').slice(-8)}`,
        name: opts.name ?? `${tag}-vessel`,
        call_sign: `E2E${randomBytes(2).toString('hex').toUpperCase()}`,
        flag_code: 'SO',
        category: 'CARGO',
        gross_tonnage_dwt: 50_000,
        engine_power_kw: 15_000,
        design_speed_knots: 18.0,
        compliance_status: 'APPROACHING',
        estimated_emissions_tco2: 0,
        tax_liability_usd: 0,
        shipowner_id: opts.shipownerId ?? null,
    };
    const { error } = await admin.from('vessels').insert(row);
    if (error) throw new Error(`[e2e/fixtures] seedVessel failed: ${error.message}`);
    return {
        id,
        imoNumber: row.imo_number,
        name: row.name,
        shipownerId: row.shipowner_id,
    };
}

export async function deleteVessel(id: string): Promise<void> {
    const { error } = await admin.from('vessels').delete().eq('id', id);
    if (error) console.warn(`[e2e/fixtures] deleteVessel(${id}) warning: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// transactions (PROFORMA / FINAL / REFUND)
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentType = 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND';

export interface TestTransaction {
    id: string;
    ref: string | null;
    vesselId: string;
    shipownerId: string;
    documentType: DocumentType;
    taxAmountUsd: number;
    status: string;
}

export async function seedProforma(opts: {
    shipownerId: string;
    vesselId: string;
    vesselImo: string;
    vesselName: string;
    amountUsd: number;
    emissionsTco2?: number;
}): Promise<TestTransaction> {
    const id = randomUUID();
    const row = {
        id,
        vessel_id: opts.vesselId,
        vessel_name: opts.vesselName,
        vessel_imo: opts.vesselImo,
        shipowner_id: opts.shipownerId,
        transaction_type: 'ENTRY_TAX',
        document_type: 'PROFORMA',
        emissions_tco2: opts.emissionsTco2 ?? 100,
        tax_amount_usd: opts.amountUsd,
        rate_usd_per_tco2: opts.emissionsTco2
            ? Number((opts.amountUsd / opts.emissionsTco2).toFixed(2))
            : 40.0,
        status: 'PENDING',
    };
    const { data, error } = await admin
        .from('transactions')
        .insert(row)
        .select('id, ref, status')
        .single();
    if (error || !data) {
        throw new Error(`[e2e/fixtures] seedProforma failed: ${error?.message ?? 'no row'}`);
    }
    return {
        id: data.id,
        ref: data.ref ?? null,
        vesselId: opts.vesselId,
        shipownerId: opts.shipownerId,
        documentType: 'PROFORMA',
        taxAmountUsd: opts.amountUsd,
        status: data.status,
    };
}

export async function deleteTransaction(id: string): Promise<void> {
    const { error } = await admin.from('transactions').delete().eq('id', id);
    if (error) console.warn(`[e2e/fixtures] deleteTransaction(${id}) warning: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// app_config feature flags
// ─────────────────────────────────────────────────────────────────────────────

async function upsertFlag(key: string, value: unknown): Promise<void> {
    const { error } = await admin
        .from('app_config')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(`[e2e/fixtures] upsertFlag(${key}) failed: ${error.message}`);
}

export async function ensurePortalEnabled(): Promise<void> {
    await upsertFlag('feature.shipowner_portal_v1_enabled', true);
}

export async function ensureSelfServiceEnabled(): Promise<void> {
    await upsertFlag('feature.shipowner_self_service_enabled', true);
}

/**
 * Reads a single app_config flag (raw JSONB value). Useful for tests that
 * want to assert / restore the prior value during cleanup.
 */
export async function readFlag(key: string): Promise<unknown> {
    const { data, error } = await admin
        .from('app_config')
        .select('value')
        .eq('key', key)
        .maybeSingle();
    if (error) throw new Error(`[e2e/fixtures] readFlag(${key}) failed: ${error.message}`);
    return data?.value ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct DB access for side-effect assertions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service-role Supabase client. Exposed so tests can read tables directly
 * to assert DB side-effects (e.g. `shipowners.account_state` flipped to
 * ACTIVE after an auto-claim, or a `payments` row got CONFIRMED).
 *
 * Use sparingly — prefer the seed/delete factories when possible. Bypasses
 * RLS, so writes here can corrupt the DB if misused.
 */
export function getAdminClient() {
    return admin;
}

/** Best-effort cleanup of any auth user with a matching email. */
export async function findUserIdByEmail(email: string): Promise<string | null> {
    // listUsers is paginated; the hosted project has many real users so we
    // filter server-side by passing a high perPage and matching exactly.
    // For the e2e suite we know the email is `e2e-*@e2e.test`, which the
    // real users will never collide with.
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return null;
    return data.users.find((u) => u.email === email)?.id ?? null;
}
