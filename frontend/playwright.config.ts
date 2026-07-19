import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// Load .env.local for the Playwright test runner process. Next.js' built-in
// dotenv only applies to the dev server subprocess (started by webServer); the
// test runner itself is a separate Node process that inherits only the shell
// environment. Without this, e2e/helpers/{auth,fixtures}.ts throw at import
// when NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't exported.
// `override: false` keeps an explicit `export` from the shell winning.
loadEnv({ path: path.resolve(__dirname, '.env.local'), override: false });

/**
 * Playwright E2E config for the Green-Gate frontend.
 *
 * Tests share rows on the hosted Supabase DB, so we keep them sequential
 * (fullyParallel: false, workers: 1). Aggressive per-test cleanup is
 * responsible for isolation; see e2e/helpers/cleanup.ts.
 *
 * `npm run dev` starts on port 3300. With `reuseExistingServer: true`,
 * a manually-started dev server will be picked up rather than spawning
 * a second one. Set `E2E_NO_SERVER=1` to disable Playwright's webServer
 * entirely (useful when pointing at a remote `E2E_BASE_URL`).
 */
export default defineConfig({
  testDir: './e2e/scenarios',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3300',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  webServer:
    process.env.E2E_NO_SERVER === '1'
      ? undefined
      : {
          command: 'npm run dev',
          url: 'http://localhost:3300',
          timeout: 60_000,
          reuseExistingServer: true,
        },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
