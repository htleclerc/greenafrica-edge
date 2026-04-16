/**
 * Cron script: Sync Verra VCS projects into Supabase
 *
 * Usage: npx tsx scripts/sync-verra.ts
 * Schedule: weekly (Sunday 02:00 UTC)
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { syncVerraToSupabase } from '../frontend/src/services/verraRegistryService';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const client = createClient(url, key);

  console.log('[sync-verra] Starting Verra VCS project sync...');
  const { synced, errors } = await syncVerraToSupabase(client, 'East Africa');
  console.log(`[sync-verra] Done: ${synced} synced, ${errors} errors`);

  process.exit(errors > 0 ? 1 : 0);
}

main();
