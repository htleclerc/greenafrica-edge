/**
 * E2E Scenario 07 — Couverture recouvrement (Tâche 14, dernière du chantier)
 *
 * Couverture volontairement légère : le fond (agrégats, RBAC, filtres) est
 * déjà couvert en unitaire (armateurService.test.ts, reglementsService.test.ts,
 * armateurFilters.test.ts). Ces deux scénarios ne vérifient que ce que
 * l'unitaire ne peut pas voir : que les écrans se chargent réellement dans un
 * navigateur authentifié, et que le clic d'en-tête de tri réordonne le DOM.
 *
 * ─── Authentification ──────────────────────────────────────────────────────
 * Reprise du patron réel de e2e/helpers/auth.ts (confirmé en lisant le
 * fichier, et son usage dans 02-wire-payment.spec.ts) : il n'existe PAS de
 * helper `loginAs` — seul un squelette de brief commenté l'évoquait, sans
 * garantir que ce nom existe. Le vrai patron est :
 *   createTestUser({ email, role }) → TestSession
 *   setSessionCookies(page, session)  → pose le cookie @supabase/ssr
 *   deleteTestUser(session.userId)    → cleanup, enregistré via
 *                                        helpers/cleanup.ts (LIFO, afterEach)
 *
 * /admin/reglements est gardé par ['FINANCE_ADMIN', 'SUPERADMIN'] uniquement
 * (PAS PORT_OFFICER — voir admin/reglements/page.tsx:11). Les deux tests de ce
 * fichier authentifient donc un FINANCE_ADMIN, rôle également accepté par
 * /admin/armateurs (['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN']).
 *
 * ─── Jeu de données (vérifié, pas supposé) ─────────────────────────────────
 * Interrogation directe de v_armateur_recouvrement sur le Supabase hébergé
 * pointé par .env.local (dyjolepwxxsedwngkfox), triée comme le fait
 * listArmateursCockpit (total_outstanding_usd désc) : 6 armateurs, dont 2
 * avec un dû distinct et non nul en tête ("Green Gate Demo Armateur" ~27992
 * USD, "Acme Maritime Corp" ~12275 USD) et 4 à égalité à 0. L'ordre par
 * défaut de la liste (dû décroissant, cf armateurService.ts) place donc une
 * ligne non nulle en première position ; useClientSort part de sort=null et
 * OsTable bascule un en-tête inactif en tri croissant dès le premier clic
 * (voir OsTable.tsx) — ce qui fait remonter une des lignes à 0, strictement
 * différente de la ligne de tête initiale. La comparaison de première ligne
 * avant/après clic est donc un signal réel sur ce jeu de données, pas un
 * artefact d'un cas à un seul armateur (le repli documenté dans le brief —
 * ne garder que la vérification d'aria-sort — ne s'applique pas ici, mais le
 * test la conserve aussi, en plus, par défense en profondeur).
 */

import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, setSessionCookies } from '../helpers/auth';
import { registerCleanup, runCleanup } from '../helpers/cleanup';
import { uniqueTag } from '../helpers/fixtures';

test.describe('recouvrement', () => {
    test.afterEach(async () => {
        await runCleanup();
    });

    test('le tableau de bord des règlements se charge', async ({ page }) => {
        const session = await createTestUser({
            email: `${uniqueTag()}-finance@e2e-test.com`,
            role: 'FINANCE_ADMIN',
        });
        registerCleanup(async () => {
            await deleteTestUser(session.userId);
        });
        await setSessionCookies(page, session);

        await page.goto('/admin/reglements');

        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // Le total impayé est rendu : la vue a répondu, la RLS n'a pas tout masqué.
        await expect(page.getByText(/\$/).first()).toBeVisible();
    });

    test('le tri du cockpit armateurs réordonne le tableau', async ({ page }) => {
        const session = await createTestUser({
            email: `${uniqueTag()}-finance@e2e-test.com`,
            role: 'FINANCE_ADMIN',
        });
        registerCleanup(async () => {
            await deleteTestUser(session.userId);
        });
        await setSessionCookies(page, session);

        await page.goto('/admin/armateurs');

        const header = page.getByRole('button', { name: /d[ûu]|outstanding/i }).first();
        const firstBefore = await page.locator('tbody tr').first().textContent();

        await header.click();

        await expect(page.locator('thead th[aria-sort]')).toHaveCount(1);

        // Voir le commentaire de jeu de données en tête de fichier : au moins
        // deux armateurs ont un dû distinct et non nul sur cet environnement,
        // donc le premier clic (desc → asc, sort partant de null) fait
        // réellement changer la première ligne.
        const firstAfter = await page.locator('tbody tr').first().textContent();
        expect(firstAfter).not.toBe(firstBefore);
    });
});
