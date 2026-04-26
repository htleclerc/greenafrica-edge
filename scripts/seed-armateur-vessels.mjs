// Seeds 2 vessels + 2 PROFORMA transactions for the demo armateur account so
// payment flows can be exercised end-to-end on the hosted DB.
//
// Idempotent: re-running upserts on imo_number (unique) and reuses existing
// transactions if a PENDING PROFORMA already exists for that vessel.
//
// Reads credentials from frontend/.env.local.

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local');
  process.exit(1);
}

const ARMATEUR_EMAIL = 'armateur@greengate.africa';

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

const hdr = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function getOwnerId() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,email,role&email=eq.${encodeURIComponent(ARMATEUR_EMAIL)}`,
    { headers: hdr },
  );
  if (!r.ok) throw new Error(`profiles lookup failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  if (!rows.length) throw new Error(`No profile found for ${ARMATEUR_EMAIL} — run scripts/add-armateur.mjs first.`);
  if (rows[0].role !== 'SHIPPING_AGENT') {
    console.warn(`⚠️  Profile ${ARMATEUR_EMAIL} has role ${rows[0].role}, expected SHIPPING_AGENT. Continuing anyway.`);
  }
  return rows[0].id;
}

async function upsertVessel(ownerId, v) {
  const body = { ...v, owner_id: ownerId };
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/vessels?on_conflict=imo_number`,
    {
      method: 'POST',
      headers: { ...hdr, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`vessel upsert (${v.imo_number}) failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows[0];
}

async function findExistingProforma(vesselId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions?select=id,status,collections_status&vessel_id=eq.${vesselId}&document_type=eq.PROFORMA&status=eq.PENDING`,
    { headers: hdr },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] ?? null;
}

async function insertProforma(ownerId, vessel) {
  const body = {
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
  };
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions`,
    {
      method: 'POST',
      headers: { ...hdr, 'Prefer': 'return=representation' },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`proforma insert (${vessel.imo_number}) failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows[0];
}

async function main() {
  const ownerId = await getOwnerId();
  console.log(`✅ Owner profile: ${ARMATEUR_EMAIL} → ${ownerId}`);

  for (const v of VESSELS) {
    const vessel = await upsertVessel(ownerId, v);
    console.log(`✅ Vessel upserted: ${vessel.name} (IMO ${vessel.imo_number}) → ${vessel.id}`);

    const existing = await findExistingProforma(vessel.id);
    if (existing) {
      console.log(`   ↪ PENDING proforma already exists (${existing.id}) — skipping`);
      continue;
    }
    const tx = await insertProforma(ownerId, vessel);
    console.log(`   ✅ PROFORMA created: ${tx.id} ($${tx.tax_amount_usd})`);
  }

  console.log('\n✅ Done. Login as armateur@greengate.africa to see the fleet under /dashboard/vessels.');
}

main().catch((e) => { console.error('❌ Fatal:', e.message ?? e); process.exit(1); });
