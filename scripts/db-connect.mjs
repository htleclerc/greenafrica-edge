import pg from 'pg';
const { Client } = pg;

const password = 'RrV6.$r&-E_Gmi5';

// Try multiple connection strategies
const configs = [
  {
    name: 'direct',
    host: 'db.dyjolepwxxsedwngkfox.supabase.co',
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
    user: 'postgres.dyjolepwxxsedwngkfox',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  },
  {
    name: 'pooler-session-eu-west-3',
    host: 'aws-0-eu-west-3.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.dyjolepwxxsedwngkfox',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  },
  {
    name: 'pooler-eu-central-1',
    host: 'aws-0-eu-central-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.dyjolepwxxsedwngkfox',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  },
  {
    name: 'pooler-eu-west-1',
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.dyjolepwxxsedwngkfox',
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  },
  {
    name: 'pooler-us-east-1',
    host: 'aws-0-us-east-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.dyjolepwxxsedwngkfox',
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
    console.log(`✅ ${name}: Connected!`, res.rows[0]);
    await client.end();
    process.exit(0);
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    try { await client.end(); } catch {}
  }
}
console.log('\nAll connections failed.');
