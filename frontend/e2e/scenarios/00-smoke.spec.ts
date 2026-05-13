import { test, expect } from '@playwright/test';

/**
 * Sanity check that the Playwright install + config + dev server all wire up.
 * Requires the Next.js dev server on baseURL (auto-started by webServer config
 * via `npm run dev`, or reuses an existing one).
 *
 * Run: `npm run e2e -- 00-smoke`
 */
test('config loads and baseURL is reachable', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
});
