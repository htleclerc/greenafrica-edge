import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import fs from 'fs';
import { getAdminClient } from '../helpers/fixtures';

test('run humanized video walkthrough', async ({ page }) => {
    // Configure longer timeout since this test is designed to run slowly and capture video
    test.setTimeout(240_000);

    // Initialise mouse tracking
    let mouseX = 0;
    let mouseY = 0;

    // Set viewport size
    await page.setViewportSize({ width: 1280, height: 800 });

    // Inject fake cursor pointer for video visual clarity
    await page.addInitScript(() => {
        const initCursor = () => {
            if (document.getElementById('playwright-fake-cursor')) return;
            const cursor = document.createElement('div');
            cursor.id = 'playwright-fake-cursor';
            cursor.style.position = 'fixed';
            cursor.style.top = '-100px';
            cursor.style.left = '-100px';
            cursor.style.width = '18px';
            cursor.style.height = '18px';
            cursor.style.background = 'rgba(34, 197, 94, 0.9)'; // GreenGate Green
            cursor.style.border = '2px solid #ffffff';
            cursor.style.borderRadius = '50%';
            cursor.style.pointerEvents = 'none';
            cursor.style.zIndex = '999999';
            cursor.style.boxShadow = '0 0 8px rgba(0,0,0,0.5)';
            cursor.style.transform = 'translate(-50%, -50%)';
            cursor.style.transition = 'transform 0.05s linear, background-color 0.1s ease';
            document.body.appendChild(cursor);

            document.addEventListener('mousemove', (e) => {
                cursor.style.left = e.clientX + 'px';
                cursor.style.top = e.clientY + 'px';
            });

            document.addEventListener('mousedown', () => {
                cursor.style.transform = 'translate(-50%, -50%) scale(0.8)';
                cursor.style.backgroundColor = 'rgba(22, 163, 74, 1)';
            });

            document.addEventListener('mouseup', () => {
                cursor.style.transform = 'translate(-50%, -50%) scale(1)';
                cursor.style.backgroundColor = 'rgba(34, 197, 94, 0.9)';
            });
        };

        if (document.body) {
            initCursor();
        } else {
            window.addEventListener('DOMContentLoaded', initCursor);
        }
    });

    // Helper functions for humanized interactions
    async function moveMouseTo(selector: string) {
        const element = page.locator(selector).first();
        await element.waitFor({ state: 'visible' });
        const box = await element.boundingBox();
        if (box) {
            const targetX = box.x + box.width / 2;
            const targetY = box.y + box.height / 2;
            
            const steps = 8;
            const startX = mouseX;
            const startY = mouseY;
            
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                const x = startX + (targetX - startX) * easeT;
                const y = startY + (targetY - startY) * easeT;
                await page.mouse.move(x, y);
                await page.waitForTimeout(5);
            }
            
            mouseX = targetX;
            mouseY = targetY;
        }
    }

    async function clickElement(selector: string) {
        await moveMouseTo(selector);
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.up();
        await page.waitForTimeout(300);
    }

    async function typeSlowly(selector: string, text: string) {
        await moveMouseTo(selector);
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.up();
        
        // Select all and clear
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(150);

        for (const char of text) {
            await page.keyboard.type(char);
            const delay = 10 + Math.random() * 25;
            await page.waitForTimeout(delay);
        }
        await page.waitForTimeout(200);
    }

    async function smoothScrollBy(pixels: number, duration: number = 800) {
        const steps = duration / 15;
        const stepPixels = pixels / steps;
        for (let i = 0; i < steps; i++) {
            await page.evaluate((y) => window.scrollBy(0, y), stepPixels);
            await page.waitForTimeout(15);
        }
        await page.waitForTimeout(200);
    }

    // ─── Scene 1: Landing Page & carbon tax estimator ───────────────────────
    console.log('Scene 1: Loading Landing Page and Simulator...');
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    // Scroll down to carbon tax estimator
    await smoothScrollBy(600);
    await page.waitForTimeout(1500);

    // Grab first slider (Vessels per month) and drag it
    const slider1 = page.locator('input[type="range"]').first();
    const box1 = await slider1.boundingBox();
    if (box1) {
        const startX = box1.x + box1.width / 2;
        const startY = box1.y + box1.height / 2;
        
        // Move to slider
        await moveMouseTo('input[type="range"]');
        await page.mouse.down();
        await page.waitForTimeout(200);
        
        // Drag to 70% of slider width
        await page.mouse.move(box1.x + box1.width * 0.7, startY, { steps: 15 });
        await page.waitForTimeout(150);
        await page.mouse.up();
        
        mouseX = box1.x + box1.width * 0.7;
        mouseY = startY;
    }
    
    await page.waitForTimeout(3000);

    // ─── Scene 2: Owner Onboarding ──────────────────────────────────────────
    console.log('Scene 2: Onboarding Owner Registration...');
    await page.goto('/owner/register');
    await page.waitForTimeout(1500);

    await typeSlowly('input[name="email"]', 'demo-armateur-register@e2e-test.com');
    await typeSlowly('input[name="name"]', 'GG Demo Video Carrier');
    await typeSlowly('input[name="imo_company_no"]', '9123456');
    await typeSlowly('input[name="country_code"]', 'SL');
    await typeSlowly('input[name="address"]', 'Berbera Port Zone');
    await typeSlowly('input[name="proof_imo_vessel_imo"]', '9654321');

    // Create dummy PDF and upload
    const dummyPdfPath = resolve(__dirname, 'dummy-proof-video.pdf');
    fs.writeFileSync(dummyPdfPath, 'dummy PDF content for video generation');
    
    // Smooth scroll in form
    await smoothScrollBy(150);
    
    await moveMouseTo('input[name="proof_doc"]');
    await page.setInputFiles('input[name="proof_doc"]', dummyPdfPath);
    await page.waitForTimeout(1000);

    // Clean up temporary dummy PDF
    if (fs.existsSync(dummyPdfPath)) {
        fs.unlinkSync(dummyPdfPath);
    }
    
    await page.waitForTimeout(3000);

    // ─── Scene 3: Command Center Radar ──────────────────────────────────────
    console.log('Scene 3: Admin Login and Command Center Map...');
    await page.goto('/login');
    await page.waitForTimeout(1500);

    await typeSlowly('input[placeholder="officer.name@berbera.gov.sl"]', 'sadmin@greengate.africa');
    await typeSlowly('input[placeholder="••••••••••••"]', 'Demo@2025!');
    await clickElement('button[type="submit"]');

    // Wait for redirect to dashboard and map load
    await expect(page).toHaveURL(/\/dashboard/i, { timeout: 15_000 });
    await page.waitForSelector('.leaflet-container', { timeout: 15_000 });
    await page.waitForTimeout(2000);

    // Hover over a ship marker on the map to show the tooltip/popover
    const marker = page.locator('.leaflet-marker-icon').first();
    const markerBox = await marker.boundingBox();
    if (markerBox) {
        await moveMouseTo('.leaflet-marker-icon');
        await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
        await page.waitForTimeout(1000);
        // Click marker to open popup
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.up();
    }
    
    await page.waitForTimeout(4000);

    // Logout admin
    const context = page.context();
    await context.clearCookies();

    // ─── Scene 4: Owner Invoices & SWIFT Declaration ────────────────────────
    console.log('Scene 4: Owner Login and SWIFT Declaration...');
    await page.goto('/owner/login');
    await page.waitForTimeout(1500);

    await typeSlowly('input[placeholder="owner@example.com"]', 'armateur@greengate.africa');
    await typeSlowly('input[placeholder="••••••••"]', 'Demo@2025!');
    await clickElement('button[type="submit"]');

    await expect(page).toHaveURL(/\/owner\/dashboard/i, { timeout: 15_000 });
    await page.waitForTimeout(1000);
    
    // Navigate to invoices
    await page.goto('/owner/invoices');
    await page.waitForTimeout(2000);

    // Locate "Pay" button
    await moveMouseTo('button:has-text("Pay")');
    await clickElement('button:has-text("Pay")');
    await page.waitForTimeout(1000);

    // Click "Bank wire"
    await clickElement('button:has-text("Bank wire")');
    await page.waitForTimeout(1000);

    // Fill SWIFT reference
    await typeSlowly('input[placeholder*="SWIFT"]', 'SWIFT-DEMO-2026-GG');
    await page.waitForTimeout(1500);

    // Click "Next"
    await clickElement('button:has-text("Next")');
    await page.waitForTimeout(1000);

    // Click "Submit payment"
    await clickElement('button:has-text("Submit payment")');
    await page.waitForTimeout(3000);

    // Logout owner
    await context.clearCookies();

    // ─── Scene 5: Admin Payment Approval & Live Map updates ─────────────────
    console.log('Scene 5: Admin Payment Approval and Live Map updates...');
    await page.goto('/login');
    await page.waitForTimeout(1500);

    await typeSlowly('input[placeholder="officer.name@berbera.gov.sl"]', 'sadmin@greengate.africa');
    await typeSlowly('input[placeholder="••••••••••••"]', 'Demo@2025!');
    await clickElement('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/i, { timeout: 15_000 });

    // Navigate to admin payments
    await page.goto('/admin/payments');
    await page.waitForTimeout(2000);

    // Find the newly created payment via short ID
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

    const targetRowSelector = `tr:has-text("${shortId}")`;
    await moveMouseTo(targetRowSelector);
    await clickElement(targetRowSelector);
    await page.waitForTimeout(1500);

    // Click "Confirm" in the drawer
    await clickElement('button:has-text("Confirm")');
    await page.waitForTimeout(4000); // Wait for processing

    // Go back to dashboard to observe compliant vessel
    await page.goto('/dashboard');
    await page.waitForSelector('.leaflet-container', { timeout: 15_000 });
    await page.waitForTimeout(4000);

    console.log('🎉 Humanized video walkthrough E2E ran successfully.');
});
