/**
 * Cron script: Sync EU MRV THETIS emissions data into Supabase
 *
 * Usage: npx tsx scripts/sync-eu-mrv.ts <path-to-csv>
 * Schedule: monthly (1st of month, 03:00 UTC)
 *
 * Download CSV from: https://mrv.emsa.europa.eu/#public/emission-report
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { syncEuMrvToSupabase } from '../frontend/src/services/euMrvService';

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/sync-eu-mrv.ts <path-to-csv>');
    console.error('Download CSV from: https://mrv.emsa.europa.eu/#public/emission-report');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const client = createClient(url, key);
  const csvContent = readFileSync(csvPath, 'utf-8');

  console.log(`[sync-eu-mrv] Parsing ${csvPath}...`);
  console.log('[sync-eu-mrv] Syncing to Supabase...');

  const { synced, errors } = await syncEuMrvToSupabase(client, csvContent);
  console.log(`[sync-eu-mrv] Done: ${synced} synced, ${errors} errors`);

  process.exit(errors > 0 ? 1 : 0);
}

main();
