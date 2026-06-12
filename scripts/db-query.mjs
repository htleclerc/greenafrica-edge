import pg from 'pg';
const { Client } = pg;

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('❌ Missing SUPABASE_DB_PASSWORD in frontend/.env.local');
  process.exit(1);
}

const query = process.argv.slice(2).join(' ');
if (!query) {
  console.error('❌ Usage: node scripts/db-query.mjs "SELECT * FROM public.shipowners LIMIT 5"');
  process.exit(1);
}

const client = new Client({
  host: 'db.dyjolepwxxsedwngkfox.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const res = await client.query(query);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
} catch (e) {
  console.error('❌ Query failed:', e.message);
  try { await client.end(); } catch {}
  process.exit(1);
}
