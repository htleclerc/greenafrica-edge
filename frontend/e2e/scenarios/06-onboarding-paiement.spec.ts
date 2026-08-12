/**
 * E2E Scenario 06 — Parcours public d'onboarding paiement armateurs
 *
 * Flow couvert (spec docs/superpowers/specs/2026-08-12-onboarding-paiement-armateurs-design.md,
 * migration 118 = `vessel_payment_teaser`) :
 *   1. Accueil → champ IMO visible sans défilement → soumission → /pay?q=…
 *   2. Le teaser ne fait jamais fuiter le montant dû.
 *   3. Identifiant IMO valide mais inconnu → « Aucun avis pour ce numéro ».
 *   4. Rattachement par code depuis un teaser OUTSTANDING claimable.
 *   5. Tutoriel /how-to-pay : 4 étapes, indexable (pas de noindex).
 *
 * ─── Gating base de données ──────────────────────────────────────────────
 * Les cas 2 et 4 ont besoin d'un navire réellement présent en base, avec un
 * avis PENDING/PARTIALLY_PAID/OVERDUE. Au moment d'écrire ce test, la
 * fonction RPC `vessel_payment_teaser` (migration 118) n'est PAS encore
 * appliquée sur le Supabase hébergé pointé par `.env.local`
 * (NEXT_PUBLIC_SUPABASE_URL=dyjolepwxxsedwngkfox) : un appel direct renvoie
 * PGRST202 « Could not find the function public.vessel_payment_teaser ».
 * lookupVesselTeaser() avale cette erreur et retourne UNKNOWN pour TOUT
 * identifiant tant que la migration n'a pas tourné — donc un test qui
 * seedrait un navire OUTSTANDING et vérifierait son contenu échouerait ici
 * pour une mauvaise raison (fonction absente), pas pour la bonne (assertion
 * métier). Ces deux cas sont donc isolés dans un describe séparé et court-
 * circuités via `test.skip(!DB_READY, …)`, gardé par la variable
 * d'environnement E2E_VESSEL_TEASER_MIGRATED. Une fois la migration 118
 * exécutée sur l'environnement cible, lancer avec
 * `E2E_VESSEL_TEASER_MIGRATED=1 npm run e2e -- e2e/scenarios/06-onboarding-paiement.spec.ts`.
 *
 * Les 3 autres cas (accueil, validation client, identifiant inconnu,
 * tutoriel) ne dépendent d'aucune donnée et s'exécutent toujours.
 *
 * Harnais repris de 01/02 (seed factories `helpers/fixtures.ts`, cleanup LIFO
 * `helpers/cleanup.ts`) — pas de second harnais inventé ici.
 */

import { test, expect } from '@playwright/test';
import {
    seedShipowner,
    seedVessel,
    seedProforma,
    deleteShipowner,
    deleteVessel,
    deleteTransaction,
    findUserIdByEmail,
} from '../helpers/fixtures';
import { deleteTestUser } from '../helpers/auth';
import { registerCleanup, runCleanup } from '../helpers/cleanup';

const DB_READY = process.env.E2E_VESSEL_TEASER_MIGRATED === '1';
const DB_SKIP_REASON =
    'nécessite la migration 118 (vessel_payment_teaser) appliquée sur le Supabase hébergé — ' +
    'lancer avec E2E_VESSEL_TEASER_MIGRATED=1 une fois la migration exécutée.';

/**
 * IMO valide au sens de la somme de contrôle (résolution A.1078(28)), mais
 * absent de la base au moment de la vérification (2026-08-12) : ni
 * vessels.imo_number ni vessels.mmsi ne portent cette valeur sur le Supabase
 * hébergé de dev. Digits: 1,0,0,0,0,1 → 1*7+0*6+0*5+0*4+0*3+1*2 = 9 → clé 9.
 */
const UNKNOWN_IMO = '1000019';

/** Génère un IMO à 7 chiffres avec une somme de contrôle valide, pour les
 * fixtures qui doivent franchir la validation côté client. */
function generateValidTestImo(): string {
    const digits = [1 + Math.floor(Math.random() * 9), ...Array.from({ length: 5 }, () => Math.floor(Math.random() * 10))];
    const weights = [7, 6, 5, 4, 3, 2];
    const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
    return `${digits.join('')}${sum % 10}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Cas sans dépendance base — s'exécutent toujours.
// ─────────────────────────────────────────────────────────────────────────

test.describe('Onboarding paiement — parcours public (sans données requises)', () => {
    test('accueil : champ IMO visible sans défilement, soumission valide → /pay?q=…', async ({ page }) => {
        // Viewport représentatif d'un poste de travail courant : le champ de
        // recherche doit apparaître au-dessus de la ligne de flottaison sans
        // défiler, c'est l'élément central du hero (voir HeroSection.tsx).
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto('/');

        const input = page.locator('#vessel-lookup-input');
        await expect(input).toBeInViewport();

        await input.fill(UNKNOWN_IMO);
        await page.getByRole('button', { name: 'Check', exact: true }).click();

        await expect(page).toHaveURL(new RegExp(`/pay\\?q=${UNKNOWN_IMO}$`));
    });

    test('validation client : une saisie invalide ne quitte jamais l\'accueil', async ({ page }) => {
        await page.goto('/');
        const input = page.locator('#vessel-lookup-input');
        const submit = page.getByRole('button', { name: 'Check', exact: true });
        const errorAlert = page.locator('#vessel-lookup-error');

        // Mauvaise longueur (5 chiffres) — rejetée avant tout appel réseau.
        await input.fill('12345');
        await submit.click();
        await expect(errorAlert).toBeVisible();
        await expect(errorAlert).toHaveText('Enter an IMO number (7 digits) or MMSI (9 digits).');
        await expect(page).toHaveURL(/\/$/);

        // 7 chiffres mais somme de contrôle invalide : mêmes 6 premiers
        // chiffres que UNKNOWN_IMO's voisin, dernier chiffre volontairement
        // faux (clé attendue 7, fournie 8).
        await input.fill('1234568');
        await submit.click();
        await expect(errorAlert).toBeVisible();
        await expect(page).toHaveURL(/\/$/);
    });

    test('identifiant inconnu : bloc « Aucun avis pour ce numéro » pour un IMO absent', async ({ page }) => {
        await page.goto(`/pay?q=${UNKNOWN_IMO}`);

        await expect(page.getByRole('heading', { name: 'No notice for this number' })).toBeVisible();
        await expect(
            page.getByText(/We have no carbon tax notice linked to this number/i)
        ).toBeVisible();

        // Corollaire structurel : l'état UNKNOWN n'a pas de `teaser`, donc ne
        // peut par construction afficher ni montant ni compteur d'avis.
        await expect(page.getByText(/notices? outstanding/i)).toHaveCount(0);
    });

    test('/how-to-pay : quatre étapes affichées, page indexable (pas de noindex)', async ({ page }) => {
        await page.goto('/how-to-pay');

        await expect(page.getByRole('heading', { name: "Pay your vessel's carbon tax" })).toBeVisible();

        const stepHeadings = [
            'Find your vessel',
            'Get your access code',
            'Review your notices',
            'Pay',
        ];
        for (const heading of stepHeadings) {
            await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        }

        // Pas de balise <meta name="robots"> du tout : contrairement à /pay et
        // /pay/claim (robots: {index:false}), cette page n'a aucune directive
        // — donc indexable par défaut. Voir metadata dans how-to-pay/page.tsx.
        await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Cas nécessitant un navire réel avec avis en attente — voir gating en tête
// de fichier. Court-circuités tant que la migration 118 n'a pas tourné sur
// l'environnement Supabase hébergé pointé par ce run.
// ─────────────────────────────────────────────────────────────────────────

test.describe('Onboarding paiement — nécessite un navire en base', () => {
    test.afterEach(async () => {
        await runCleanup();
    });

    test('le montant ne fuit jamais sur un teaser OUTSTANDING', async ({ page }) => {
        test.skip(!DB_READY, DB_SKIP_REASON);

        const shipowner = await seedShipowner({ state: 'ACTIVE' });
        registerCleanup(async () => { await deleteShipowner(shipowner.id); });

        const vesselImo = generateValidTestImo();
        const vessel = await seedVessel({ shipownerId: shipowner.id, imoNumber: vesselImo });
        registerCleanup(async () => { await deleteVessel(vessel.id); });

        const amountUsd = 87_654.32;
        const proforma = await seedProforma({
            shipownerId: shipowner.id,
            vesselId: vessel.id,
            vesselImo: vessel.imoNumber,
            vesselName: vessel.name,
            amountUsd,
        });
        registerCleanup(async () => { await deleteTransaction(proforma.id); });

        await page.goto(`/pay?q=${vesselImo}`);
        await expect(page.getByText(/notices? outstanding/i)).toBeVisible();

        const bodyText = await page.locator('body').innerText();

        // Pas de symbole dollar, pas la valeur exacte du fixture (brute ni
        // formatée avec séparateur de milliers), et pas de motif monétaire
        // générique (nombre suivi/précédé de $ ou USD).
        expect(bodyText).not.toContain('$');
        expect(bodyText).not.toContain(String(amountUsd));
        expect(bodyText).not.toContain(amountUsd.toLocaleString('en-US'));
        expect(bodyText).not.toMatch(/(\$\s?\d[\d,.]*)|(\d[\d,.]*\s?(usd))/i);
    });

    test('rattachement : indice masqué affiché, adresse jamais en clair', async ({ page }) => {
        test.skip(!DB_READY, DB_SKIP_REASON);

        const shipowner = await seedShipowner({ state: 'ACTIVE' });
        registerCleanup(async () => { await deleteShipowner(shipowner.id); });

        const vesselImo = generateValidTestImo();
        const vessel = await seedVessel({ shipownerId: shipowner.id, imoNumber: vesselImo });
        registerCleanup(async () => { await deleteVessel(vessel.id); });

        const proforma = await seedProforma({
            shipownerId: shipowner.id,
            vesselId: vessel.id,
            vesselImo: vessel.imoNumber,
            vesselName: vessel.name,
            amountUsd: 12_000,
        });
        registerCleanup(async () => { await deleteTransaction(proforma.id); });

        // requestVesselAccessCode appelle signInWithOtp(shouldCreateUser:true) :
        // si aucun compte n'existe pour official_email, un auth user est créé
        // en side-effect. On l'enregistre pour nettoyage avant de déclencher
        // l'envoi, pour ne rien laisser fuiter même si une assertion échoue.
        registerCleanup(async () => {
            const userId = await findUserIdByEmail(shipowner.officialEmail);
            if (userId) await deleteTestUser(userId);
        });

        await page.goto(`/pay?q=${vesselImo}`);
        await page.getByRole('link', { name: 'View and pay' }).click();
        await expect(page).toHaveURL(new RegExp(`/pay/claim\\?q=${vesselImo}$`));

        await page.getByRole('button', { name: 'Send me my code' }).click();

        const hint = page.getByText(/^Address: /);
        await expect(hint).toBeVisible({ timeout: 10_000 });

        const hintText = await hint.innerText();
        // maskEmailHint() ne renvoie jamais l'adresse en clair : elle contient
        // toujours au moins un caractère de masquage (•).
        expect(hintText).toContain('•');
        expect(hintText).not.toContain(shipowner.officialEmail);

        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain(shipowner.officialEmail);
    });
});
