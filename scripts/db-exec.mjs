import pg from 'pg';
const { Client } = pg;

// Reads password from frontend/.env.local (Node 20.12+ built-in, no dotenv needed).
process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('❌ Missing SUPABASE_DB_PASSWORD in frontend/.env.local');
  process.exit(1);
}

const connConfigs = [
  {
    name: 'direct-5432',
    host: 'db.dyjolepwxxsedwngkfox.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  },
  {
    name: 'direct-6543',
    host: 'db.dyjolepwxxsedwngkfox.supabase.co',
    port: 6543,
    database: 'postgres',
    user: 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  },
  {
    name: 'connstring-direct',
    connectionString: `postgresql://postgres:${encodeURIComponent(password)}@db.dyjolepwxxsedwngkfox.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  },
  {
    name: 'pooler-eu-west-1',
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.dyjolepwxxsedwngkfox',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  },
  {
    name: 'pooler-eu-central-1',
    host: 'aws-0-eu-central-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.dyjolepwxxsedwngkfox',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  },
  {
    name: 'pooler-us-east-1',
    host: 'aws-0-us-east-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.dyjolepwxxsedwngkfox',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  },
];

for (const cfg of connConfigs) {
  const { name, ...opts } = cfg;
  const client = new Client(opts);
  try {
    await client.connect();
    const res = await client.query('SELECT current_database() AS db, current_user AS usr');
    console.log(`✅ ${name}:`, res.rows[0]);

    // If connected, run diagnostic
    const triggers = await client.query(`
      SELECT tgname, proname, tgenabled
      FROM pg_trigger t
      JOIN pg_proc p ON t.tgfoid = p.oid
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'auth' AND c.relname = 'users'
    `);
    console.log('Auth triggers:', JSON.stringify(triggers.rows));

    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log('Public tables:', tables.rows.map(r => r.table_name).join(', '));

    await client.end();
    process.exit(0);
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    try { await client.end(); } catch {}
  }
}
console.log('\nAll connections failed.');
process.exit(1);
