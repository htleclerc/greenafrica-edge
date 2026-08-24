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
 *
 * ─── Migration 121 (v_reglements_dashboard) — pas encore sur l'hébergé ─────
 * Confirmé le 2026-08-20 par requête directe sur dyjolepwxxsedwngkfox : la vue
 * n'existe pas. Elle est créée par
 * supabase/migrations/121_reglements_dashboard.sql (ainsi que 122→127,
 * aucune des sept appliquée) ; ces migrations partent par la CI au
 * déploiement, hors plan de ce chantier. Tant qu'elle n'est pas là,
 * getReglementsSummary() lève ("Could not find the table
 * 'public.v_reglements_dashboard'") et /admin/reglements ne rend jamais son
 * contenu — confirmé par une exécution réelle de ce fichier, pas supposé. Le
 * test correspondant est donc sauté par défaut (test.skip conditionnel, avec
 * un console.log de la même raison pour qu'elle soit visible directement
 * dans la sortie Playwright, pas seulement dans ce commentaire) afin de ne
 * pas laisser un rouge d'environnement dans le dépôt. Lever le skip : lancer
 * avec E2E_REGLEMENTS_MIGRATED=1 une fois la migration 121 appliquée sur
 * l'environnement ciblé.
 *
 * ─── Liste blanche e2e-nightly.yml ─────────────────────────────────────────
 * Ce fichier n'est PAS dans la liste blanche du workflow
 * .github/workflows/e2e-nightly.yml (qui ne lance que 00-smoke,
 * 01-signup-auto-claim, 02-wire-payment). L'y ajouter est un geste de
 * déploiement, pas fait ici.
 */

import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, setSessionCookies } from '../helpers/auth';
import { registerCleanup, runCleanup } from '../helpers/cleanup';
import { uniqueTag } from '../helpers/fixtures';

const REGLEMENTS_MIGRATED = process.env.E2E_REGLEMENTS_MIGRATED === '1';
const REGLEMENTS_SKIP_REASON =
    "SKIP: migration 121 (v_reglements_dashboard) non appliquee sur l'environnement cible - " +
    'lancer avec E2E_REGLEMENTS_MIGRATED=1 une fois la migration 121 appliquee.';

test.describe('recouvrement', () => {
    test.afterEach(async () => {
        await runCleanup();
    });

    test('le tableau de bord des règlements se charge', async ({ page }) => {
        // console.log (et pas seulement l'annotation test.skip) pour que la raison
        // du saut soit visible telle quelle dans la sortie Playwright, y compris
        // avec les reporters terse (list/line) qui n'impriment pas la description
        // d'annotation inline — voir la demande de vérification du round 1.
        if (!REGLEMENTS_MIGRATED) console.log(REGLEMENTS_SKIP_REASON);
        test.skip(!REGLEMENTS_MIGRATED, REGLEMENTS_SKIP_REASON);

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
