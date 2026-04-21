// Creates / upserts a demo SHIPPING_AGENT (armateur) via Supabase Admin REST API.
// Reads credentials from frontend/.env.local (Node 20.12+ built-in, no dotenv needed).

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local');
  process.exit(1);
}

const NEW = {
  email: 'armateur@greengate.africa',
  password: 'Demo@2025!',
  fullName: 'Green Gate Demo Armateur',
  role: 'SHIPPING_AGENT',
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
      operational_site: 'BERBERA_PORT',
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
}

main().catch((e) => { console.error('❌ Fatal:', e); process.exit(1); });
