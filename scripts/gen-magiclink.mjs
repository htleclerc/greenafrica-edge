// Generates a magic-link for sadmin@greengate.africa redirecting to the dashboard.
// Reads credentials from frontend/.env.local (Node 20.12+ built-in, no dotenv needed).

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local');
  process.exit(1);
}

const EMAIL       = 'sadmin@greengate.africa';
const REDIRECT_TO = 'https://greengate.africa/dashboard';

const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    type: 'magiclink',
    email: EMAIL,
    options: { redirect_to: REDIRECT_TO },
  }),
});

if (!resp.ok) {
  console.error('❌', resp.status, await resp.text());
  process.exit(1);
}

const data = await resp.json();
const link = data.properties?.action_link || data.action_link;
const hashedToken = data.properties?.hashed_token || data.hashed_token;

console.log('\n✅ Magic link generated');
console.log('Email:    ', EMAIL);
console.log('Redirect: ', REDIRECT_TO);
console.log('Link:     ', link);
if (hashedToken) console.log('Token:    ', hashedToken);
console.log('\nℹ️  Default OTP expiry on this Supabase project applies (see project settings).');
