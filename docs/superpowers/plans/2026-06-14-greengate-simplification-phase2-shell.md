# Phase 2 — Shell unique (fin du `/owner` séparé) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Les opérateurs (armateurs/transporteurs) vivent dans le MÊME shell que le staff (même layout, sidebar, design) ; l'URL `/owner` disparaît (redirections conservées). On **réutilise les pages owner serveur+RLS telles quelles** derrière des routes `(dashboard)` qui **délèguent selon le principal**.

**Architecture:** Garde commun `requirePrincipal()` → `{ kind: 'operator'|'staff', ... }`. Le layout `(dashboard)` et la `DashboardSidebar` deviennent **principal-aware** : un opérateur voit une nav opérateur dédiée. Chaque route partagée (`/dashboard/vessels`, `/dashboard/invoices`, `/dashboard/alerts`, …) est un petit **routeur de délégation** : si opérateur → rend le composant owner (déplacé de `owner/(portal)/*` vers `components/owner/pages/*`), sinon → rend la page staff existante. Les pages opérateur gardent `session.supabase` (RLS owner). Routes opérateur-seules ajoutées : `/dashboard/wallet`, `/dashboard/notifications`. Le bounce middleware shipowner→`/owner/*` est retiré.

**Tech Stack:** Next.js 16 App Router, TS strict, Supabase SSR, Vitest, next-intl.

**Décisions PO (2026-06-14):** (1) réutiliser les pages owner sous `/dashboard` (pas de fusion page-par-page adaptive) ; (2) principal opérateur résolu par le shell, AUCUN nouveau rôle DB. On conserve `PayDialog` owner, les routes `/api/owner/*`, et le namespace i18n `OwnerPortal`.

---

## Principe de délégation (référence pour toutes les tâches de pages)

Une route partagée devient :

```tsx
// (dashboard)/dashboard/<concept>/page.tsx
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import OperatorXxx from '@/components/owner/pages/OperatorXxxPage';   // logique owner déplacée
import StaffXxx from '@/components/dashboard/<concept>/StaffXxxPage'; // page staff existante

export default async function Page(props: PageProps) {
    const principal = await requirePrincipal();
    if (principal.kind === 'operator') return <OperatorXxx principal={principal} {...props} />;
    return <StaffXxx {...props} />;
}
```

`requirePrincipal()` ne redirige PAS par lui-même quand un opérateur est détecté ; il renvoie le contexte (session owner incluse) pour que le composant opérateur réutilise `session.supabase` exactement comme `requireOwner` aujourd'hui.

---

## File Structure

| Fichier | Action |
|---|---|
| `frontend/src/lib/auth/requirePrincipal.ts` (+ `.test.ts`) | **Créer** — garde unique opérateur/staff |
| `frontend/src/lib/auth/operatorNav.ts` (+ `.test.ts`) | **Créer** — liste de nav opérateur + helper de sélection |
| `frontend/src/components/owner/pages/*` | **Déplacer** depuis `app/owner/(portal)/*/page.tsx` (extraire la logique en composants réutilisables prenant `principal` en prop) |
| `frontend/src/app/(dashboard)/dashboard/{vessels,invoices,alerts,disputes}/page.tsx` | **Modifier** — délégation par principal |
| `frontend/src/app/(dashboard)/dashboard/{wallet,notifications}/page.tsx` | **Créer** — routes opérateur-seules |
| `frontend/src/app/(dashboard)/dashboard/page.tsx` | **Modifier** — overview opérateur si principal opérateur |
| `frontend/src/components/dashboard/layout/DashboardSidebar.tsx` | **Modifier** — nav opérateur si principal opérateur |
| `frontend/src/app/(dashboard)/layout.tsx` | **Modifier** — transmettre le principal au shell |
| `frontend/src/middleware.ts` | **Modifier** — retirer le bounce shipowner ; rediriger `/owner/*` → `/dashboard/*` |
| `frontend/src/lib/auth/loginDestination.ts` (+ test) | **Modifier** — opérateur → `/dashboard` |
| `frontend/src/app/owner/(portal)/**` | **Supprimer** après relocation (garder `owner/register`, `owner/onboarding`, `owner/reset-password`, `owner/auth/callback`) |
| `frontend/src/components/owner/OwnerShell.tsx` | **Supprimer** (remplacé par le shell dashboard) |
| Tests owner/middleware | **Adapter** |

---

## Task 1 : Garde unique `requirePrincipal()`

**Files:** Create `frontend/src/lib/auth/requirePrincipal.ts` + `.test.ts`

- [ ] **Step 1 — Test (comportement)**

Tester avec un mock du client Supabase serveur (`@/lib/supabase/server`) : (a) pas de session → redirect `/login` ; (b) ligne `shipowners` ACTIVE → `{ kind:'operator', userId, shipowner, jurisdictionId, supabase }` ; (c) shipowners INVITED → redirect `/login?error=state_invited` ; (d) pas de shipowners mais profile staff actif → `{ kind:'staff', user, role, supabase }` ; (e) profile inactif → redirect `/pending-approval`.

```typescript
// requirePrincipal.test.ts — squelette des cas (mock createClient)
import { describe, it, expect, vi, beforeEach } from 'vitest';
// vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// vi.mock('next/navigation', () => ({ redirect: vi.fn((p)=>{throw new Error('REDIRECT:'+p)}) }))
// Cas (a)..(e) ci-dessus, en assertant le shape de retour ou le redirect levé.
```

- [ ] **Step 2 — Vérifier l'échec**

Run: `cd frontend && npx vitest run src/lib/auth/requirePrincipal.test.ts` → FAIL (module absent).

- [ ] **Step 3 — Implémenter**

Composer la logique des deux gardes existantes : détecter d'abord l'opérateur (réutiliser la requête `shipowners` de `requireOwner` + assertion `account_state==='ACTIVE'`), sinon retomber sur la résolution staff de `requireRole` (profiles + is_active). Type de retour discriminé :

```typescript
// requirePrincipal.ts (forme attendue)
export type Principal =
  | { kind: 'operator'; userId: string; email: string; shipowner: ShipownerListRow; jurisdictionId: string; supabase: SupabaseClient }
  | { kind: 'staff'; user: SecureUser; supabase: SupabaseClient };

export async function requirePrincipal(): Promise<Principal> { /* … */ }
```

Réutiliser les redirections cohérentes avec Phase 1 (`/login`, `/login?error=state_…`, `/pending-approval`).

- [ ] **Step 4 — Vérifier le succès** : `npx vitest run src/lib/auth/requirePrincipal.test.ts` → PASS.
- [ ] **Step 5 — Commit** : `feat(auth): garde unique requirePrincipal (opérateur|staff)`

---

## Task 2 : Nav opérateur principal-aware

**Files:** Create `frontend/src/lib/auth/operatorNav.ts` + `.test.ts` ; Modify `DashboardSidebar.tsx`, `(dashboard)/layout.tsx`

- [ ] **Step 1** — `operatorNav.ts` : liste ordonnée des items opérateur (Dashboard, Ma flotte, Factures, Wallet, Simulateur, TCO, Litiges, Notifications) avec `key`, `href` (`/dashboard`, `/dashboard/vessels`, `/dashboard/invoices`, `/dashboard/wallet`, `/dashboard/simulator`, `/dashboard/tco`, `/dashboard/disputes`, `/dashboard/notifications`), libellés via i18n `OwnerPortal.nav.*`. Test : la liste contient exactement ces 8 clés/hrefs.
- [ ] **Step 2** — vérifier l'échec, puis implémenter, puis succès.
- [ ] **Step 3** — `(dashboard)/layout.tsx` : résoudre le principal (ou recevoir un flag `isOperator` via un petit fetch `requirePrincipal` côté server boundary, OU via une route `/api/me/principal`) et le passer à `DashboardSidebar`. Choisir le mécanisme le plus simple compatible avec le layout client actuel (probablement une route `GET /api/me/principal` lue par la sidebar, en miroir de `JurisdictionSwitcher`). Documenter le choix.
- [ ] **Step 4** — `DashboardSidebar.tsx` : si opérateur → rendre `operatorNav` (sans filtrage RBAC, l'opérateur a sa propre liste) ; sinon → comportement staff actuel (`filterNavItems` + `JurisdictionSwitcher`). Le `JurisdictionSwitcher` reste masqué pour un opérateur mono-juridiction (il l'est déjà : 1 membership → label statique ; un opérateur n'a pas de `user_jurisdictions` staff donc 0 → caché).
- [ ] **Step 5** — gates (`tsc`, vitest ciblé), commit : `feat(shell): nav opérateur dans le shell unifié`

---

## Task 3 : Relocation des pages opérateur (réutilisation)

Pour CHAQUE concept ci-dessous : (a) extraire la logique de `app/owner/(portal)/<x>/page.tsx` dans un composant `components/owner/pages/Operator<X>Page.tsx` qui prend `principal` (opérateur) en prop et réutilise `principal.supabase`/`principal.shipowner` ; (b) brancher la délégation dans la route `(dashboard)` correspondante (cf. « Principe de délégation »). Un sous-commit par concept.

- [ ] **3a — vessels** : déléguer `(dashboard)/dashboard/vessels/page.tsx`. Composant opérateur = ancien `owner/(portal)/vessels`. Corriger les back-links internes `/owner/vessels` → `/dashboard/vessels`, fiche `[id]` incluse.
- [ ] **3b — invoices** : déléguer `(dashboard)/dashboard/invoices/page.tsx`. Conserver `InvoicesTable` owner + `PayDialog` owner + bannières `?stripe=`. NE PAS router l'opérateur vers le `handlePayNow` legacy staff (risque de paiement cassé documenté). Liens `/owner/*` → `/dashboard/*`.
- [ ] **3c — alerts** : déléguer `(dashboard)/dashboard/alerts/page.tsx`. Opérateur = page alerts owner (server, `arrival_alerts` RLS). Staff garde sa page client actuelle.
- [ ] **3d — disputes** : déléguer `(dashboard)/dashboard/disputes/page.tsx`. Opérateur = `OwnerDisputesList` (`getDisputesBySubmitter`).
- [ ] **3e — wallet** (route opérateur-seule) : créer `(dashboard)/dashboard/wallet/page.tsx` rendant la page wallet owner (réutilise `createTenantClient(jurisdictionId)`, `getWalletForOwner`, etc.). Pour un staff, renvoyer 404/redirect (la nav staff ne l'affiche pas).
- [ ] **3f — notifications** (route opérateur-seule) : créer `(dashboard)/dashboard/notifications/page.tsx` rendant `NotificationsPageClient` (API `/api/owner/notifications` conservée).
- [ ] **3g — overview** : `(dashboard)/dashboard/page.tsx` rend l'overview opérateur (4 stat cards + quick-actions, liens `/dashboard/*`) si principal opérateur, sinon le dashboard staff existant.
- [ ] **simulator / tco** : déjà partagés. Vérifier que pour un opérateur, `TaxSimulatorPage` et `ShippingAgentView` fonctionnent DANS le shell `(dashboard)` (le `RoleProvider` existe désormais — corriger le bug latent `useRole()` en assignant au principal opérateur un rôle effectif `SHIPPING_AGENT` côté `RoleContext`, ou en rendant `ShippingAgentView` tolérant à un principal opérateur). Documenter le choix.

Après CHAQUE sous-tâche : `tsc` + vitest ciblé verts, commit `feat(shell): <concept> opérateur sous /dashboard`.

---

## Task 4 : Routage — retirer le bounce, rediriger `/owner/*`

**Files:** Modify `middleware.ts`, `loginDestination.ts` (+ test)

- [ ] **Step 1** — `loginDestination.ts` : changer la destination opérateur de `/owner/dashboard` → `/dashboard`. Mettre à jour le test (la note Phase 1 « operators route to legacy /owner shell » devient « operators route to the unified /dashboard »).
- [ ] **Step 2** — `middleware.ts` : SUPPRIMER le bloc de bounce (lignes ~201-209), ainsi que `isActiveShipowner`, `_shipownerCache`, `SHIPOWNER_CACHE_TTL_MS`, `LEGACY_TO_OWNER_MAP`, `mapLegacyToOwner`. Les opérateurs accèdent désormais à `/dashboard/*` normalement.
- [ ] **Step 3** — `middleware.ts` : rediriger les anciennes URLs `/owner/<x>` → `/dashboard/<x>` (301) pour les chemins relocalisés (vessels, invoices, alerts, disputes, wallet, notifications, dashboard). Garder publics et fonctionnels : `/owner/register`, `/owner/onboarding/*`, `/owner/reset-password`, `/owner/auth/callback` (NON relocalisés en P2). Décommissionner le flag `feature.shipowner_portal_v1_enabled` du gating `/owner/*` relocalisé (le réutiliser ou le retirer — documenter).
- [ ] **Step 4** — gates + commit : `feat(routing): opérateurs dans /dashboard, redirections /owner→/dashboard, retrait du bounce`

---

## Task 5 : Nettoyage — suppression du portail séparé

**Files:** Delete `app/owner/(portal)/**`, `components/owner/OwnerShell.tsx` ; fix `KycCBanner` link ; adapter `auth/callback` + `onboarding` redirects.

- [ ] **Step 1** — Supprimer `app/owner/(portal)/layout.tsx` et les `page.tsx` relocalisés (vessels, invoices, alerts, disputes, wallet, notifications, dashboard, simulator, tco). Vérifier qu'aucune route relocalisée ne reste sous `owner/(portal)`.
- [ ] **Step 2** — Supprimer `OwnerShell.tsx` + son test de nav (`OwnerShell.nav.test.tsx`) — devenus inutiles.
- [ ] **Step 3** — `KycCBanner` : conserver, mais le réutiliser dans le shell `(dashboard)` pour les opérateurs (afficher si `principal.kind==='operator' && !kycComplete`), lien vers `/owner/onboarding/billing` (route conservée).
- [ ] **Step 4** — `owner/auth/callback/route.ts` : la redirection succès `/owner/dashboard` → `/dashboard`. `owner/onboarding/billing` redirect post-complétion `/owner/dashboard` → `/dashboard`.
- [ ] **Step 5** — gates + commit : `refactor(shell): suppression du portail /owner séparé`

---

## Task 6 : Tests + gates finaux

- [ ] **Step 1** — Adapter/supprimer les tests listés dans la cartographie (OwnerShell.nav, OwnerDisputesList si déplacé, PayDialog/Wallet/NotificationBell conservés, `rbac.test.ts` inchangé car pas de nouveau rôle, mocks middleware `/owner/login`→`/login` de Phase 1). Mettre à jour les chemins d'import des composants déplacés vers `components/owner/pages/*`.
- [ ] **Step 2** — Régler la dette Phase 1 reportée : strings de test obsolètes `/owner/login` (resserrer à `/login`), bannière `?portal_disabled=` (si le flag est conservé), `requireOwner`/`requirePrincipal` transmettre `redirectTo` (cohérence avec le middleware).
- [ ] **Step 3** — Gates complets :

Run: `cd frontend && npx tsc --noEmit && npm run test && npm run build`
Expected: tsc clean ; vitest vert ; build OK ; `grep -rn "owner/(portal)\|OwnerShell" src` → vide.

- [ ] **Step 4** — Commit final éventuel : `test(shell): adaptation des tests à la fusion du shell`

---

## Critères de succès Phase 2

- Un opérateur se connecte et atterrit dans le shell `(dashboard)` (même design/sidebar), avec sa nav opérateur ; plus aucune surface `/owner/(portal)`.
- Les anciennes URLs `/owner/<x>` redirigent vers `/dashboard/<x>`.
- Le staff est inchangé ; l'admin est inchangé.
- Les pages opérateur conservent leur scope RLS (via `principal.supabase`).
- Bounce middleware retiré ; `loginDestination` opérateur → `/dashboard`.
- Gates verts : tsc, vitest, build ; aucune référence à `OwnerShell`/`owner/(portal)`.

## Self-review (effectuée)

- **Couverture spec §5 P2** : shell unique ✓ (délégation par principal), suppression `/owner` ✓, nav filtrée par principal ✓, `requirePrincipal()` ✓ (Task 1), opérateur garde ses fonctions ✓ (wallet/tco/simulator/disputes relocalisés). **Filtre de mode (maritime/air) et exposition du sélecteur de pays = reportés en Phase 2.5/3** (ils s'appliquent surtout aux dashboards admin/manager ; à câbler avec la vision board P3) — écart documenté.
- **Placeholders** : les pages relocalisées réutilisent du code existant (pas de réécriture) ; les steps référencent les composants source exacts. Les squelettes de test (Task 1/2) sont des cas explicites, pas des TODO.
- **Risques couverts** : `useRole()` sous opérateur (Task 3 simulator/tco) ; flux paiement legacy évité (Task 3b) ; RLS préservée (principal.supabase) ; redirections legacy (Task 4).
- **Cohérence types** : `Principal` discriminé défini en Task 1, consommé en Task 3 (`principal.kind`, `principal.supabase`, `principal.shipowner`).
