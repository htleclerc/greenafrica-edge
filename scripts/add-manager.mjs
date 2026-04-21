// Creates / upserts a demo MANAGER (platform sub-admin, ops-only).
// Reads credentials from frontend/.env.local (Node 20.12+ built-in, no dotenv needed).

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local');
  process.exit(1);
}

const NEW = {
  email: 'manager@greengate.africa',
  password: 'Manager@2025!',
  fullName: 'Green Gate Demo Manager',
  role: 'MANAGER',
};

const hdr = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function main() {
  const listResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(NEW.email)}`, { headers: hdr });
  const listJson = await listResp.json().catch(() => ({}));
  const existing = (listJson.users || []).find(u => u.email?.toLowerCase() === NEW.email.toLowerCase());

  let userId;

  if (existing) {
    userId = existing.id;
    console.log(`ℹ️  User ${NEW.email} already exists (${userId}) — updating password + confirming email`);
    const patch = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: hdr,
      body: JSON.stringify({
        password: NEW.password,
        email_confirm: true,
        user_metadata: { full_name: NEW.fullName, role: NEW.role },
      }),
    });
    if (!patch.ok) {
      console.error('❌ PUT admin/users failed:', patch.status, await patch.text());
      process.exit(1);
    }
  } else {
    const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({
        email: NEW.email,
        password: NEW.password,
        email_confirm: true,
        user_metadata: { full_name: NEW.fullName, role: NEW.role },
      }),
    });
    if (!create.ok) {
      console.error('❌ Create user failed:', create.status, await create.text());
      process.exit(1);
    }
    const data = await create.json();
    userId = data.id;
    console.log(`✅ Created auth user: ${userId}`);
  }

  const upsert = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: { ...hdr, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      id: userId,
      email: NEW.email,
      full_name: NEW.fullName,
      role: NEW.role,
      operational_site: 'NATIONAL_HQ',
      country_code: 'SO',
      timezone: 'Africa/Mogadishu',
      preferred_language: 'fr',
      is_active: true,
      is_demo: true,
    }),
  });
  if (!upsert.ok) {
    console.error('❌ Upsert profile failed:', upsert.status, await upsert.text());
    process.exit(1);
  }
  console.log(`✅ Profile upserted with role ${NEW.role}`);

  const verify = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=email,role,is_active,is_demo`, { headers: hdr });
  console.log('→ Final state:', (await verify.json())[0]);

  console.log('\n📋 Login credentials:');
  console.log(`   Email:    ${NEW.email}`);
  console.log(`   Password: ${NEW.password}`);
  console.log('\n🧪 What to test:');
  console.log('   ✓ Can log in (auth + RoleContext loads MANAGER profile)');
  console.log('   ✓ Sees ops nav: vessels, alerts, validations, audit, inspector, registrations');
  console.log('   ✗ DOES NOT see money-rail nav: tax-settings, revenue, payments, my-fleet, green-ledger');
  console.log('   ✗ Direct URL /admin/payment-config returns 401/403 (server enforced)');
}

main().catch((e) => { console.error('❌ Fatal:', e); process.exit(1); });
