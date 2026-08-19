// Seeds 2 vessels + 2 PROFORMA transactions for the demo armateur account so
// payment flows can be exercised end-to-end on the hosted DB.
//
// Each pro-forma is also *issued*: the PDF is rendered, uploaded to the private
// `documents` bucket and the transaction is stamped with its ref / content hash
// / storage path. Without that step the row shows up in the armateur portal with
// no downloadable document — the transaction exists but the pro-forma does not.
//
// Idempotent: re-running upserts on imo_number (unique), reuses an existing
// PENDING PROFORMA, and re-issues the document only when it is missing.
//
// Usage: npx tsx scripts/seed-armateur-vessels.ts
//        npx tsx scripts/seed-armateur-vessels.ts --origin https://greengate.africa
//
// Reads credentials from frontend/.env.local.

import { createClient } from '@supabase/supabase-js';
import { issueInvoiceDocument } from '../frontend/src/services/invoiceIssuanceService';

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const args = process.argv.slice(2);
const originFlag = args.indexOf('--origin');
const ORIGIN =
    (originFlag >= 0 ? args[originFlag + 1] : undefined)
    || process.env.NEXT_PUBLIC_APP_URL
    || 'http://localhost:3300';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local');
    process.exit(1);
}

const ARMATEUR_EMAIL = 'armateur@greengate.africa';
/** Roles allowed to issue a fiscal document, most authoritative first. */
const STAFF_ROLES = ['SUPERADMIN', 'FINANCE_ADMIN', 'PORT_OFFICER'];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const VESSELS = [
    {
        imo_number: '9839272',
        mmsi: '636092841',
        name: 'GG DEMO STAR',
        call_sign: 'D5GG1',
        flag_code: 'LR',
        category: 'CONTAINER',
        gross_tonnage_dwt: 78500,
        engine_power_kw: 28000,
        design_speed_knots: 22.5,
        compliance_status: 'PAYMENT_DUE',
        estimated_emissions_tco2: 412.50,
        tax_liability_usd: 16500.00,
        port_call: 'BERBERA',
        pro_forma_generated: true,
    },
    {
        imo_number: '9745311',
        mmsi: '636094572',
        name: 'GG DEMO PIONEER',
        call_sign: 'D5GG2',
        flag_code: 'PA',
        category: 'BULK_CARRIER',
        gross_tonnage_dwt: 56200,
        engine_power_kw: 18500,
        design_speed_knots: 14.8,
        compliance_status: 'PAYMENT_DUE',
        estimated_emissions_tco2: 287.30,
        tax_liability_usd: 11492.00,
        port_call: 'BERBERA',
        pro_forma_generated: true,
    },
];

type SeedVessel = (typeof VESSELS)[number];
interface VesselRow extends SeedVessel { id: string }
interface TxnRow {
    id: string;
    tax_amount_usd: number;
    invoice_ref: string | null;
    invoice_pdf_url: string | null;
    jurisdiction_id: string;
}

const TXN_COLUMNS = 'id, tax_amount_usd, invoice_ref, invoice_pdf_url, jurisdiction_id';

async function getOwnerId(): Promise<string> {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, email, role')
        .eq('email', ARMATEUR_EMAIL)
        .limit(1);
    if (error) throw new Error(`profiles lookup failed: ${error.message}`);
    if (!data?.length) {
        throw new Error(`No profile found for ${ARMATEUR_EMAIL} — run scripts/add-armateur.mjs first.`);
    }
    if (data[0].role !== 'SHIPPING_AGENT') {
        console.warn(`⚠️  Profile ${ARMATEUR_EMAIL} has role ${data[0].role}, expected SHIPPING_AGENT. Continuing anyway.`);
    }
    return data[0].id;
}

async function getIssuer(): Promise<{ id: string; fullName: string }> {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .in('role', STAFF_ROLES)
        .limit(50);
    if (error) throw new Error(`staff lookup failed: ${error.message}`);
    if (!data?.length) {
        throw new Error(`No staff profile (${STAFF_ROLES.join(', ')}) to issue the pro-formas — run scripts/add-sadmin.mjs first.`);
    }
    const rows = data as { id: string; full_name: string | null; email: string | null; role: string }[];
    const chosen = [...rows].sort((a, b) => STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role))[0];
    return { id: chosen.id, fullName: chosen.full_name || chosen.email || 'Seed script' };
}

async function upsertVessel(ownerId: string, v: SeedVessel): Promise<VesselRow> {
    const { data, error } = await supabase
        .from('vessels')
        .upsert({ ...v, owner_id: ownerId }, { onConflict: 'imo_number' })
        .select()
        .single();
    if (error) throw new Error(`vessel upsert (${v.imo_number}) failed: ${error.message}`);
    return data as VesselRow;
}

async function findExistingProforma(vesselId: string): Promise<TxnRow | null> {
    const { data, error } = await supabase
        .from('transactions')
        .select(TXN_COLUMNS)
        .eq('vessel_id', vesselId)
        .eq('document_type', 'PROFORMA')
        .eq('status', 'PENDING')
        .limit(1);
    if (error) return null;
    return (data?.[0] as TxnRow) ?? null;
}

async function insertProforma(ownerId: string, vessel: VesselRow): Promise<TxnRow> {
    const { data, error } = await supabase
        .from('transactions')
        .insert({
            vessel_id: vessel.id,
            vessel_name: vessel.name,
            vessel_imo: vessel.imo_number,
            transaction_type: 'ENTRY_TAX',
            document_type: 'PROFORMA',
            emissions_tco2: vessel.estimated_emissions_tco2,
            tax_amount_usd: vessel.tax_liability_usd,
            rate_usd_per_tco2: 40.00,
            status: 'PENDING',
            collections_status: 'CURRENT',
            debtor_profile_id: ownerId,
            agent_profile_id: ownerId,
            port_call: vessel.port_call,
        })
        .select(TXN_COLUMNS)
        .single();
    if (error) throw new Error(`proforma insert (${vessel.imo_number}) failed: ${error.message}`);
    return data as TxnRow;
}

async function main() {
    const ownerId = await getOwnerId();
    console.log(`✅ Owner profile: ${ARMATEUR_EMAIL} → ${ownerId}`);

    const issuer = await getIssuer();
    console.log(`✅ Issuing staff: ${issuer.fullName} (${issuer.id})`);

    for (const v of VESSELS) {
        const vessel = await upsertVessel(ownerId, v);
        console.log(`✅ Vessel upserted: ${vessel.name} (IMO ${vessel.imo_number}) → ${vessel.id}`);

        let txn = await findExistingProforma(vessel.id);
        if (txn) {
            console.log(`   ↪ PENDING proforma already exists (${txn.id})`);
        } else {
            txn = await insertProforma(ownerId, vessel);
            console.log(`   ✅ PROFORMA created: ${txn.id} ($${txn.tax_amount_usd})`);
        }

        // Issue the document itself. Skipped when the PDF is already in storage
        // so re-running the seed doesn't re-render or re-audit.
        if (txn.invoice_pdf_url) {
            console.log(`   ↪ document already issued (${txn.invoice_ref}) — skipping`);
            continue;
        }
        const result = await issueInvoiceDocument({
            admin: supabase,
            transactionId: txn.id,
            jurisdictionId: txn.jurisdiction_id,
            actor: issuer,
            origin: ORIGIN,
            sendEmail: false,
        });
        if (result.ok) {
            console.log(`   ✅ PROFORMA issued: ${result.invoiceRef} → ${result.storagePath}`);
        } else {
            console.error(`   ❌ issuance failed (${result.status}): ${result.error}`);
            process.exitCode = 1;
        }
    }

    console.log('\n✅ Done. Login as armateur@greengate.africa to see the fleet under /dashboard/vessels.');
}

main().catch((e) => { console.error('❌ Fatal:', e?.message ?? e); process.exit(1); });
