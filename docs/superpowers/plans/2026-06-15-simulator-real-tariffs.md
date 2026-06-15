# Simulateur sur tarifs réels (P2 #14) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Le simulateur de taxe carbone (maritime) calcule avec le **tarif réel versionné** (`tariffs`) de la juridiction active, au lieu du lookup legacy `tax_configurations`/mock + fallback hardcodé `?? 20`/`?? 15`. **Fail-closed** si aucun tarif actif.

**Architecture:** Un nouvel endpoint `GET /api/simulator/tariff` résout la juridiction via `requirePrincipal` (opérateur → sa juridiction ; staff → juridiction active) et renvoie le tarif MARITIME actif (`rate_per_tco2`, `currency`) depuis `tariffs` (`as_of`=aujourd'hui), ou `null` si absent. `TaxSimulatorPage` consomme ce taux **unique** (le modèle réel n'a pas de distinction EEZ/PORT ni par catégorie — un seul tarif par juridiction/mode) et l'applique au CO2 total ; bannière fail-closed si pas de tarif. On retire `useTaxConfigs`/mock + les fallbacks `?? 20`/`?? 15` + la bannière « legacy rates ».

**Tech Stack:** Next.js 16 App Router, TS strict, Supabase, Vitest, next-intl.

**Décisions PO (2026-06-15) :** endpoint serveur + fail-closed (pas de fallback 20) ; périmètre **maritime** uniquement (simulateur aérien = chantier distinct).

**Réalité données (vérifiée) :** `tariffs` = colonnes `jurisdiction_id, mode, asset_category, zone, rate_per_tco2, currency, status, effective_from, effective_to`. `asset_category`/`zone` **vides** dans le seed ; **un seul tarif** par (juridiction, mode) — Somaliland MARITIME = 40 USD/tCO2. Donc **taux unique**, pas de multiplier (colonne inexistante), pas de lookup zone/catégorie.

---

## File Structure

| Fichier | Action |
|---|---|
| `frontend/src/app/api/simulator/tariff/route.ts` (+ `route.test.ts`) | **Créer** — endpoint tarif actif par principal |
| `frontend/src/components/dashboard/simulator/TaxSimulatorPage.tsx` | **Modifier** — consommer le tarif réel, fail-closed, retirer legacy |
| `frontend/messages/{en,fr,pt,sw,ar}.json` | **Modifier** — bannières tarif officiel / non publié |

---

## Task 1 : Endpoint `GET /api/simulator/tariff`

**Files:** Create `frontend/src/app/api/simulator/tariff/route.ts` + `route.test.ts`

Modèle d'auth/principal : `frontend/src/app/api/me/principal/route.ts` + `frontend/src/lib/auth/requirePrincipal.ts`. Résolution juridiction : `requirePrincipal` (opérateur → `principal.jurisdictionId` ; staff → `getServerJurisdictionId()` de `@/lib/auth/tenantContext`).

- [ ] **Step 1 — Test** (mock `createClient`/principal + query builder, style `notification-email-loop/route.test.ts`) : (a) non authentifié → 401 ; (b) opérateur → requête `tariffs` filtrée sur `principal.jurisdictionId` + `mode='MARITIME'` + `status='ACTIVE'` + fenêtre de date, renvoie `{ ratePerTco2: 40, currency:'USD', jurisdictionId }` ; (c) staff → juridiction du cookie ; (d) aucun tarif actif → `{ ratePerTco2: null }` (fail-closed côté client).

- [ ] **Step 2 — Échec** : `cd frontend && npx vitest run src/app/api/simulator/tariff/route.test.ts` → FAIL.

- [ ] **Step 3 — Implémenter**
```ts
// route.ts
import { NextResponse } from 'next/server';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const principal = await requirePrincipal(); // redirige si non authentifié
    const jurisdictionId = principal.kind === 'operator'
        ? principal.jurisdictionId
        : await getServerJurisdictionId();
    if (!jurisdictionId) return NextResponse.json({ ratePerTco2: null });

    const today = new Date().toISOString().slice(0, 10);
    const { data } = await principal.supabase
        .from('tariffs')
        .select('rate_per_tco2, currency')
        .eq('jurisdiction_id', jurisdictionId)
        .eq('mode', 'MARITIME')
        .eq('status', 'ACTIVE')
        .lte('effective_from', today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();

    return NextResponse.json({
        jurisdictionId,
        ratePerTco2: data ? Number(data.rate_per_tco2) : null,
        currency: data?.currency ?? 'USD',
    });
}
```
⚠️ `requirePrincipal` fait un `redirect()` si non authentifié — dans une route API c'est acceptable (renvoie une réponse de redirection). Si les tests exigent un 401 JSON propre, remplacer par une résolution inline (cf. `/api/me/principal` qui renvoie 401) : adapte selon le pattern le plus simple à tester. Documente le choix.

- [ ] **Step 4 — Succès** : vitest ciblé vert.
- [ ] **Step 5 — Commit** : `feat(simulator): endpoint /api/simulator/tariff (tarif maritime actif par juridiction)`

## Task 2 : `TaxSimulatorPage` consomme le tarif réel (fail-closed)

**Files:** Modify `frontend/src/components/dashboard/simulator/TaxSimulatorPage.tsx`

Contexte actuel : `useTaxConfigs()` (hook legacy/mock) ; `calculate(inputs, taxConfigs)` fait `eezConfig?.baseRateUsdPerTco2 ?? 20` et `portConfig?.baseRateUsdPerTco2 ?? 15` ; bannière `simulator_legacy_rates_notice`.

- [ ] **Step 1 — Récupérer le tarif réel** : remplacer l'usage de `useTaxConfigs` par un fetch de `/api/simulator/tariff` (état `{ ratePerTco2: number | null, currency, loading }` via `useEffect`). Retirer l'import `useTaxConfigs` + `mockTaxConfigs` indirects.
- [ ] **Step 2 — Calcul taux unique** : modifier `calculate()` pour prendre `ratePerTco2: number` (au lieu de `taxConfigs`) ; appliquer ce taux unique à `eezCo2` ET `portCo2` (`eezTax = eezCo2 * ratePerTco2`, `portTax = (includePort ? portCo2 : 0) * ratePerTco2`). Retirer multiplier + lookups zone/catégorie + les `?? 20/?? 15`. `effectiveRate = ratePerTco2`. (Le PDF reçoit le même taux pour les 2 lignes EEZ/PORT.)
- [ ] **Step 3 — Fail-closed UI** : si `ratePerTco2 === null` (pas de tarif publié pour la juridiction) → afficher une bannière « tarif non publié — calcul indisponible » et désactiver le calcul + le bouton PDF (pas de montant à 0/20). Pendant `loading` → état neutre.
- [ ] **Step 4 — Bannières** : retirer la bannière `simulator_legacy_rates_notice` ; ajouter un indicateur « Tarif officiel : {rate} {currency}/tCO₂ » (clé i18n). 
- [ ] **Step 5 — Vérifier** : `cd frontend && npx tsc --noEmit` ; si un test existant du simulateur casse (mock), l'adapter.
- [ ] **Step 6 — Commit** : `feat(simulator): calcul sur le tarif réel + fail-closed (retire mock + taux 20)`

## Task 3 : i18n

**Files:** Modify `frontend/messages/{en,fr,pt,sw,ar}.json`

- [ ] **Step 1** : sous le namespace du simulateur (celui de `TaxSimulatorPage`, ex. `Simulator`), ajouter dans les 5 locales : `simulator_official_rate` (« Tarif officiel : {rate} {currency}/tCO₂ »), `simulator_no_tariff_title`, `simulator_no_tariff_body` (« Aucun tarif publié pour cette juridiction. Le calcul est indisponible — contactez l'administration. »). Retirer (ou laisser inutilisée) `simulator_legacy_rates_notice`. Traductions réelles.
- [ ] **Step 2 — Vérifier** : `for f in frontend/messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"; done` → OK.
- [ ] **Step 3 — Commit** : `feat(i18n): bannières tarif officiel / tarif non publié (simulateur)`

## Task 4 : Gates

- [ ] **Step 1** : `cd frontend && npx tsc --noEmit && npm run test && npm run build` → tout vert.
- [ ] **Step 2 — Vérif manuelle (revue)** : avec un tarif actif (Somaliland 40) → le simulateur affiche « Tarif officiel : 40 USD/tCO₂ » et calcule à 40 ; sans tarif → bannière fail-closed, pas de calcul.

---

## Critères de succès

- Le simulateur n'utilise plus `tax_configurations`/mock ni les fallbacks `?? 20`/`?? 15`.
- Le calcul utilise le `rate_per_tco2` MARITIME actif de la juridiction (opérateur = sa juridiction ; staff = juridiction active).
- Fail-closed : pas de tarif publié → bannière + calcul désactivé (jamais 0/20 silencieux).
- Bannière « legacy rates » retirée ; indicateur du tarif officiel affiché.
- Périmètre maritime (aérien différé). Gates verts : tsc, vitest, build, i18n valides.

## Self-review (effectuée)

- **Couverture design** : endpoint serveur par principal ✓ (Task 1), fail-closed ✓ (Task 2 Step 3), retrait mock/20 ✓ (Task 2), maritime only ✓.
- **Réalité données** : taux unique (pas de multiplier/zone/catégorie) reflété dans `calculate()` (Task 2 Step 2).
- **Placeholders** : code concret pour l'endpoint ; le `⚠️` sur `requirePrincipal` vs 401 est un choix d'implémentation explicite (suivre le pattern testable).
- **Cohérence types** : `calculate(inputs, ratePerTco2: number)` cohérent entre définition et appel ; l'endpoint renvoie `{ratePerTco2, currency, jurisdictionId}` consommé tel quel par la page.
