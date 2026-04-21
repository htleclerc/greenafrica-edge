// Apply a single Supabase migration file via direct pg connection.
// Reads SUPABASE_DB_PASSWORD from frontend/.env.local.
//
// Usage:
//   node scripts/db-migrate.mjs supabase/migrations/020_add_manager_role.sql
//
// The migration is sent as a single multi-statement query. If your
// migration contains ALTER TYPE ... ADD VALUE, that statement auto-commits
// (it cannot run in a transaction in older PG versions); design migrations
// to be idempotent so rerunning after a partial failure is safe.

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const { Client } = pg;

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('❌ Missing SUPABASE_DB_PASSWORD in frontend/.env.local');
  process.exit(1);
}

const migrationPath = process.argv[2];
if (!migrationPath) {
  console.error('Usage: node scripts/db-migrate.mjs <path-to-migration.sql>');
  process.exit(1);
}

const sql = readFileSync(resolve(migrationPath), 'utf8');
console.log(`📄 Applying ${migrationPath} (${sql.length} bytes)`);

// Try direct connection first, fall back to the eu-west-1 pooler if needed.
const candidates = [
  {
    name: 'direct-5432',
    host: 'db.dyjolepwxxsedwngkfox.supabase.co',
    port: 5432,
    user: 'postgres',
  },
  {
    name: 'pooler-eu-west-1',
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.dyjolepwxxsedwngkfox',
  },
];

for (const cfg of candidates) {
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    database: 'postgres',
    user: cfg.user,
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    console.log(`🔌 Connected via ${cfg.name}`);

    const t0 = Date.now();
    await client.query(sql);
    console.log(`✅ Migration applied in ${Date.now() - t0}ms`);

    // Verify the MANAGER enum value landed (specific to migration 020 — ignored otherwise)
    const enumCheck = await client.query(`
      SELECT enumlabel FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'user_role'
      ORDER BY e.enumsortorder
    `);
    console.log('🔍 user_role enum values:', enumCheck.rows.map(r => r.enumlabel).join(', '));

    await client.end();
    process.exit(0);
  } catch (e) {
    console.log(`❌ ${cfg.name}: ${e.message}`);
    try { await client.end(); } catch {}
  }
}

console.error('All connections failed.');
process.exit(1);
