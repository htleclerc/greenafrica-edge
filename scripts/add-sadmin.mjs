// Creates / upserts a SUPERADMIN via Supabase Admin REST API + PostgREST.
// No direct PG connection needed.
// Reads credentials from frontend/.env.local (Node 20.12+ built-in, no dotenv needed).

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local');
  process.exit(1);
}

const NEW = {
  email: 'sadmin@greengate.africa',
  password: 'Demo@2025!',
  fullName: 'Green Gate Superadmin',
  role: 'SUPERADMIN',
};

const hdr = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function main() {
  // 1. Check whether user already exists via listing (filter by email)
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

  // 2. Upsert profile row with SUPERADMIN role (service_role bypasses RLS)
  const upsert = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: {
      ...hdr,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
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
      is_demo: false,
    }),
  });
  if (!upsert.ok) {
    console.error('❌ Upsert profile failed:', upsert.status, await upsert.text());
    process.exit(1);
  }
  console.log('✅ Profile upserted with role SUPERADMIN');

  // 3. Verify
  const verify = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=email,role,is_active`, { headers: hdr });
  const verifyJson = await verify.json();
  console.log('→ Final state:', verifyJson[0]);
}

main().catch((e) => { console.error('❌ Fatal:', e); process.exit(1); });
