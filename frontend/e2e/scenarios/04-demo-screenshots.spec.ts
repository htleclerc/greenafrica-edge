import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import fs from 'fs';
import { getAdminClient } from '../helpers/fixtures';

test('capture screenshots for 5-scene demo walkthrough', async ({ page }) => {
    // Ensure the output screenshots folder exists
    const screenshotDir = resolve(__dirname, '../../../qa-screenshots');
    if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // Adjust resolution for premium, crisp screenshots
    await page.setViewportSize({ width: 1280, height: 800 });

    // Set test timeout to 60 seconds since it contains multiple scenes and screenshots
    test.setTimeout(60_000);

    // ─── Scene 1: Landing & Estimateur ─────────────────────────────────────
    console.log('Scene 1: Loading Landing Page and Simulator...');
    await page.goto('/');
    // Wait for the estimate section
    const estimatorSection = page.locator('input[type="range"]').first();
    if (await estimatorSection.isVisible().catch(() => false)) {
        await estimatorSection.scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(2000); // Wait for page assets and layout to settle
    await page.screenshot({ path: resolve(screenshotDir, '01-landing-estimator.png') });

    // ─── Scene 2: Enregistrement Armateur ─────────────────────────────────────
    console.log('Scene 2: Loading Onboarding Owner Registration...');
    await page.goto('/signup');
    await page.fill('input[name="email"]', 'demo-armateur-register@e2e-test.com');
    await page.fill('input[name="name"]', 'GG Demo Video Carrier');
    await page.fill('input[name="imo_company_no"]', '9123456');
    await page.fill('input[name="country_code"]', 'SL');
    await page.fill('input[name="address"]', 'Berbera Port Zone');
    await page.fill('input[name="proof_imo_vessel_imo"]', '9654321');
    
    // Create a temporary dummy PDF file
    const dummyPdfPath = resolve(__dirname, 'dummy-proof.pdf');
    fs.writeFileSync(dummyPdfPath, 'dummy PDF content for proof of ownership');
    await page.setInputFiles('input[name="proof_doc"]', dummyPdfPath);
    
    await page.screenshot({ path: resolve(screenshotDir, '02-owner-registration.png') });
    // Clean up temporary dummy PDF
    if (fs.existsSync(dummyPdfPath)) {
        fs.unlinkSync(dummyPdfPath);
    }

    // ─── Scene 3: Command Center Radar ─────────────────────────────────────
    console.log('Scene 3: Admin Login and Command Center Map...');
    await page.goto('/login');
    await page.fill('input[placeholder="officer.name@berbera.gov.sl"]', 'sadmin@greengate.africa');
    await page.fill('input[placeholder="••••••••••••"]', 'Demo@2025!');
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/i, { timeout: 15_000 });
    // Wait for the map to render
    await page.waitForSelector('.leaflet-container', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(3000); // Allow vessel icons to load on the map
    await page.screenshot({ path: resolve(screenshotDir, '03-admin-dashboard.png') });

    // Logout admin
    const context = page.context();
    await context.clearCookies();

    // ─── Scene 4: Portail Armateur & Déclaration de Paiement SWIFT ───────────
    console.log('Scene 4: Owner Login and SWIFT Declaration...');
    await page.goto('/owner/login');
    await page.fill('input[placeholder="owner@example.com"]', 'armateur@greengate.africa');
    await page.fill('input[placeholder="••••••••"]', 'Demo@2025!');
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await expect(page).toHaveURL(/\/owner\/dashboard/i, { timeout: 15_000 });
    
    // Navigate to invoices list page
    await page.goto('/owner/invoices');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(screenshotDir, '04-owner-invoices-list.png') });

    // Open Pay Dialog
    const payBtn = page.getByRole('button', { name: /^Pay$/i }).first();
    await payBtn.click();
    await page.waitForTimeout(1000);

    // Step 1: select Bank Wire (SWIFT)
    await page.getByRole('button', { name: /Bank wire/i }).click();
    // Step 2: enter reference
    await page.fill('input[placeholder*="SWIFT"]', 'SWIFT-DEMO-2026-GG');
    await page.screenshot({ path: resolve(screenshotDir, '04-owner-payment-ref.png') });
    await page.getByRole('button', { name: /^Next$/i }).click();
    await page.waitForTimeout(500);

    // Step 3: submit payment
    await page.getByRole('button', { name: /Submit payment/i }).click();
    await page.waitForTimeout(2000); // Wait for modal completion and redirection

    // Logout owner
    await context.clearCookies();

    // ─── Scene 5: L'Approbation Douanière & Mise à jour Live ────────────────
    console.log('Scene 5: Admin Payment Approval and Live ZEE Status update...');
    await page.goto('/login');
    await page.fill('input[placeholder="officer.name@berbera.gov.sl"]', 'sadmin@greengate.africa');
    await page.fill('input[placeholder="••••••••••••"]', 'Demo@2025!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/i, { timeout: 15_000 });

    // Navigate to payments admin
    await page.goto('/admin/payments');
    await page.waitForTimeout(2000);

    // Locate the payment row by querying the database for the newly declared payment
    const adminClient = getAdminClient();
    const { data: pmt } = await adminClient
        .from('payments')
        .select('id')
        .eq('rail', 'WIRE_TRANSFER')
        .eq('status', 'INITIATED')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    
    expect(pmt).toBeTruthy();
    const shortId = pmt!.id.slice(0, 8);
    console.log(`Locating payment row with short ID: ${shortId}`);

    const paymentRow = page.locator('tr', { hasText: shortId }).first();
    await expect(paymentRow).toBeVisible({ timeout: 15_000 });
    await paymentRow.click();
    await page.waitForTimeout(1000);

    // Confirm payment in drawer
    const confirmBtn = page.getByRole('button', { name: /^Confirm$/ });
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: resolve(screenshotDir, '05-admin-review-drawer.png') });
    await confirmBtn.click();
    await page.waitForTimeout(3000); // Wait for backend processing (receipt, status recompute, etc)

    // Navigate back to radar dashboard to show compliance updates
    await page.goto('/dashboard');
    await page.waitForSelector('.leaflet-container', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(3000); // Let map render refreshed compliancy colors
    await page.screenshot({ path: resolve(screenshotDir, '05-admin-confirmation-live.png') });

    console.log('🎉 Walkthrough E2E script ran successfully and screenshots generated.');
});
