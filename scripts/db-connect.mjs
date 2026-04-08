import pg from 'pg';
const { Client } = pg;

const password = process.env.SUPABASE_DB_PASSWORD;
const projectRef = process.env.SUPABASE_PROJECT_REF;

if (!password || !projectRef) {
  console.error('Missing env vars. Set SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_REF');
  console.error('Example: SUPABASE_DB_PASSWORD=xxx SUPABASE_PROJECT_REF=xxx node scripts/db-connect.mjs');
  process.exit(1);
}

// Try multiple connection strategies
const configs = [
  {
    name: 'direct',
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  },
  {
    name: 'pooler-transaction-eu-west-3',
    host: 'aws-0-eu-west-3.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  },
  {
    name: 'pooler-session-eu-west-3',
    host: 'aws-0-eu-west-3.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  },
];

for (const cfg of configs) {
  const { name, ...connCfg } = cfg;
  const client = new Client(connCfg);
  try {
    await client.connect();
    const res = await client.query('SELECT current_database(), current_user, version()');
    console.log(`OK ${name}: Connected!`, res.rows[0]);
    await client.end();
    process.exit(0);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
    try { await client.end(); } catch {}
  }
}
console.log('\nAll connections failed.');
