# Phase 3 — Vision board MANAGER + filtre de mode + sélecteur pays — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Donner au rôle MANAGER une **unique vision board lecture seule** (navires/avions au port, en approche, derniers départs, factures payées 7j, impayées en cours) ; ajouter un **filtre de mode** (maritime/aérien/les deux) pour admin & manager ; confirmer l'**exposition du sélecteur de pays** (déjà présent).

**Architecture:** Nouveau `visionService` agrège les 5 widgets depuis `arrival_alerts` (status + mode + aircraft_id) et `transactions` (status + paid_at + mode), scopé par juridiction (client staff RLS + cookie `gg-active-jurisdiction` existant) et par un nouveau **mode actif** (cookie `gg-active-mode`, valeurs `MARITIME|AIR|BOTH`, défaut `BOTH`). Un `ModeSwitcher` (miroir de `JurisdictionSwitcher`) vit dans la sidebar staff. La nav de MANAGER est réduite à une seule entrée `vision` ; MANAGER atterrit sur `/dashboard/vision`.

**Tech Stack:** Next.js 16 App Router, TS strict, Supabase SSR, Vitest, next-intl (locales en/fr/pt/sw/ar).

**Décisions PO :** MANAGER = vision board lecture seule, AUCUN nouveau rôle DB. Filtre mode = pour admin & manager. Sélecteur pays = réutiliser l'existant. Vue « ensemble » multi-pays agrégée = HORS scope (différée).

**Portée du filtre de mode (P3) :** le `ModeSwitcher` est exposé pour admin & manager, et la **vision board** respecte le mode actif. Le filtrage par mode des AUTRES listes staff (vessels/alerts/etc.) est **hors scope P3** (à étendre plus tard) — documenté.

---

## File Structure

| Fichier | Action |
|---|---|
| `frontend/src/lib/auth/activeMode.ts` (+ `.test.ts`) | **Créer** — `ACTIVE_MODE_COOKIE`, `ActiveMode` type, `getServerActiveMode()` |
| `frontend/src/actions/setActiveMode.ts` (+ `.test.ts`) | **Créer** — écrit le cookie httpOnly (valide la valeur) |
| `frontend/src/app/api/me/modes/route.ts` | **Créer** — modes activés de la juridiction active + mode actif courant |
| `frontend/src/components/dashboard/layout/ModeSwitcher.tsx` (+ `.test.tsx`) | **Créer** — switcher Maritime/Aérien/Les deux |
| `frontend/src/components/dashboard/layout/DashboardSidebar.tsx` | **Modifier** — monter `ModeSwitcher` (staff) |
| `frontend/src/services/visionService.ts` (+ `.test.ts`) | **Créer** — agrège les 5 widgets (mode + juridiction) |
| `frontend/src/app/(dashboard)/dashboard/vision/page.tsx` | **Créer** — route vision board |
| `frontend/src/components/dashboard/vision/VisionBoard.tsx` | **Créer** — UI lecture seule (5 widgets) |
| `frontend/src/lib/rbac.ts` | **Modifier** — clé `vision`, MANAGER réduit à `vision` |
| `frontend/src/lib/__tests__/rbac.test.ts` | **Modifier** — refléter la réduction MANAGER |
| `frontend/src/lib/auth/loginDestination.ts` (+ test) | **Modifier** — MANAGER → `/dashboard/vision` |
| `frontend/src/app/(dashboard)/dashboard/page.tsx` | **Modifier** — MANAGER → vision (redirect) |
| `frontend/messages/{en,fr,pt,sw,ar}.json` | **Modifier** — `Vision`, `ModeSwitcher`, `Dashboard.nav_vision` |

---

## Task 1 : Lecture serveur du mode actif

**Files:** Create `frontend/src/lib/auth/activeMode.ts` + `.test.ts`

- [ ] **Step 1 — Test**

```typescript
// activeMode.test.ts
import { describe, it, expect, vi } from 'vitest';
import { normalizeActiveMode, ACTIVE_MODE_COOKIE } from './activeMode';

describe('normalizeActiveMode', () => {
  it('accepts MARITIME / AIR / BOTH', () => {
    expect(normalizeActiveMode('MARITIME')).toBe('MARITIME');
    expect(normalizeActiveMode('AIR')).toBe('AIR');
    expect(normalizeActiveMode('BOTH')).toBe('BOTH');
  });
  it('defaults unknown/empty to BOTH', () => {
    expect(normalizeActiveMode(undefined)).toBe('BOTH');
    expect(normalizeActiveMode('xxx')).toBe('BOTH');
    expect(normalizeActiveMode(null)).toBe('BOTH');
  });
  it('exposes the cookie name', () => {
    expect(ACTIVE_MODE_COOKIE).toBe('gg-active-mode');
  });
});
```

- [ ] **Step 2 — Échec** : `cd frontend && npx vitest run src/lib/auth/activeMode.test.ts` → FAIL.

- [ ] **Step 3 — Implémenter**

```typescript
// activeMode.ts
import { cookies } from 'next/headers';

export const ACTIVE_MODE_COOKIE = 'gg-active-mode';
export type ActiveMode = 'MARITIME' | 'AIR' | 'BOTH';

export function normalizeActiveMode(raw: string | null | undefined): ActiveMode {
  return raw === 'MARITIME' || raw === 'AIR' || raw === 'BOTH' ? raw : 'BOTH';
}

/** Server read of the active mode filter. BOTH (no filter) is the safe default. */
export async function getServerActiveMode(): Promise<ActiveMode> {
  const store = await cookies();
  return normalizeActiveMode(store.get(ACTIVE_MODE_COOKIE)?.value);
}

/** null = no filter (BOTH); otherwise the single transport_mode to filter on. */
export function modeFilter(mode: ActiveMode): 'MARITIME' | 'AIR' | null {
  return mode === 'BOTH' ? null : mode;
}
```

- [ ] **Step 4 — Succès** : vitest vert.
- [ ] **Step 5 — Commit** : `feat(dashboard): lecture serveur du mode actif (cookie gg-active-mode)`

---

## Task 2 : Action `setActiveMode`

**Files:** Create `frontend/src/actions/setActiveMode.ts` + `.test.ts`

Modèle : `frontend/src/actions/setActiveJurisdiction.ts` (lis-le pour le pattern cookie httpOnly + retour `{ok}`).

- [ ] **Step 1 — Test** : asserte qu'une valeur valide écrit le cookie `gg-active-mode` avec `httpOnly:true, sameSite:'lax', path:'/'` et renvoie `{ok:true}` ; qu'une valeur invalide renvoie `{ok:false}` sans écrire. Mocke `next/headers` `cookies()`.

```typescript
// setActiveMode.test.ts (forme)
import { describe, it, expect, vi, beforeEach } from 'vitest';
// vi.mock('next/headers', () => ({ cookies: vi.fn() }))  // store.set spy
// cas: 'MARITIME' → ok:true + set appelé avec ACTIVE_MODE_COOKIE ; 'xxx' → ok:false + set NON appelé
```

- [ ] **Step 2 — Échec.**
- [ ] **Step 3 — Implémenter**

```typescript
// setActiveMode.ts
'use server';
import { cookies } from 'next/headers';
import { ACTIVE_MODE_COOKIE, normalizeActiveMode, type ActiveMode } from '@/lib/auth/activeMode';

export async function setActiveMode({ mode }: { mode: string }): Promise<{ ok: boolean }> {
  const valid: ActiveMode[] = ['MARITIME', 'AIR', 'BOTH'];
  if (!valid.includes(mode as ActiveMode)) return { ok: false };
  const store = await cookies();
  store.set(ACTIVE_MODE_COOKIE, normalizeActiveMode(mode), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}
```

- [ ] **Step 4 — Succès.**
- [ ] **Step 5 — Commit** : `feat(dashboard): action setActiveMode`

---

## Task 3 : Route `/api/me/modes`

**Files:** Create `frontend/src/app/api/me/modes/route.ts`

Modèle : `frontend/src/app/api/me/jurisdictions/route.ts` (auth + client). La route renvoie les modes ACTIVÉS pour la juridiction active (lecture `jurisdiction_mode_config` via le client de session, RLS « anyone reads mode config ») + le mode actif courant.

- [ ] **Step 1 — Implémenter**

```typescript
// route.ts (forme)
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { getServerActiveMode } from '@/lib/auth/activeMode';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jurisdictionId = await getServerJurisdictionId().catch(() => null);
  let enabled: ('MARITIME' | 'AIR')[] = [];
  if (jurisdictionId) {
    const { data } = await supabase
      .from('jurisdiction_mode_config')
      .select('mode, enabled')
      .eq('jurisdiction_id', jurisdictionId)
      .eq('enabled', true);
    enabled = (data ?? []).map((r) => r.mode as 'MARITIME' | 'AIR');
  }
  const active = await getServerActiveMode();
  return NextResponse.json({ enabled, active });
}
```

- [ ] **Step 2 — Vérifier** : `cd frontend && npx tsc --noEmit` propre. (Route triviale ; pas de test unitaire dédié requis — couverte par le composant.)
- [ ] **Step 3 — Commit** : `feat(api): /api/me/modes (modes activés + mode actif)`

---

## Task 4 : Composant `ModeSwitcher` + montage sidebar

**Files:** Create `frontend/src/components/dashboard/layout/ModeSwitcher.tsx` + `.test.tsx` ; Modify `DashboardSidebar.tsx`

Modèle exact : `JurisdictionSwitcher.tsx` (fetch `/api/me/modes`, états loading/error/retry, `<select>` ou label statique). Comportement :
- fetch `/api/me/modes` → `{ enabled, active }`.
- `enabled.length <= 1` → ne rien afficher (un seul mode = pas de filtre utile).
- `enabled.length > 1` → `<select>` avec options « Les deux » (`BOTH`), « Maritime » (`MARITIME`), « Aérien » (`AIR`) ; `onChange` → `setActiveMode({mode})` + `router.refresh()`.
- i18n namespace `ModeSwitcher` (`label`, `both`, `maritime`, `air`, `error`, `retry`).

- [ ] **Step 1 — Test** (mirror JurisdictionSwitcher.test) : 0/1 mode → rien ; >1 → select ; onChange appelle `setActiveMode` + refresh ; erreur fetch → message+retry. Mocke `setActiveMode` et `fetch`.
- [ ] **Step 2 — Échec.**
- [ ] **Step 3 — Implémenter** `ModeSwitcher.tsx` (copie adaptée de JurisdictionSwitcher ; `value = active`).
- [ ] **Step 4 — Monter dans `DashboardSidebar.tsx`** : dans `renderStaffNav()`, juste sous `<JurisdictionSwitcher .../>`, ajouter `<ModeSwitcher expanded={expanded || mobileOpen} />`. (Donc visible pour TOUT staff dont admin & manager ; auto-caché si la juridiction n'a qu'un mode.)
- [ ] **Step 5 — Succès** (vitest ciblé) + commit : `feat(dashboard): ModeSwitcher maritime/aérien/les deux dans la sidebar`

---

## Task 5 : `visionService` (agrégation des 5 widgets)

**Files:** Create `frontend/src/services/visionService.ts` + `.test.ts`

Modèle de style : `frontend/src/services/ownerPortalService.ts` (`getOwnerCounters`). La fonction prend un client Supabase (déjà RLS staff, scopé juridiction par les politiques + le cookie) et le filtre de mode.

- [ ] **Step 1 — Test** (mock du query builder Supabase, comme `ownerPortalService` ou `kpiService` tests) : vérifie les filtres appliqués pour chaque widget et l'application du filtre mode (quand `modeFilter` non-null → `.eq('mode', …)` ; quand null → pas de `.eq('mode')`). Au moins : at-port compte `status='ARRIVED'`, approaching compte les statuts en cours, departures liste `DEPARTED_EEZ` récents, paid7d somme/compte `status='PAID'` & `paid_at>=now-7d`, unpaid compte `status='PENDING'`.

- [ ] **Step 2 — Échec.**
- [ ] **Step 3 — Implémenter**

```typescript
// visionService.ts (forme — adapter aux helpers de query du repo)
import type { SupabaseClient } from '@supabase/supabase-js';

export interface VisionCounters {
  atPort: number;            // arrival_alerts status ARRIVED
  approaching: number;       // DETECTED|MATCHED_AUTO|UNCLAIMED|CLAIMED|ESCALATED|PROFORMA_SENT
  recentDepartures: Array<{ id: string; ref: string; mode: 'MARITIME'|'AIR'; departedAt: string }>; // DEPARTED_EEZ, 7j, limit 20
  paidLast7dCount: number;
  paidLast7dUsd: number;
  unpaidInProgressCount: number;
  unpaidInProgressUsd: number;
}

const APPROACHING_STATUSES = ['DETECTED','MATCHED_AUTO','UNCLAIMED','CLAIMED','ESCALATED','PROFORMA_SENT'];

export async function getVisionCounters(
  db: SupabaseClient,
  opts: { mode: 'MARITIME' | 'AIR' | null },
): Promise<VisionCounters> {
  const withMode = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    opts.mode ? q.eq('mode', opts.mode) : q;
  // … requêtes count/select sur arrival_alerts (status, mode, departed_eez_at)
  //   et transactions (status, paid_at, document_type, mode, tax_amount_usd) …
  //   somme USD via les montants ; respecte la convention de montant du repo (cents→$ /100.0 si nécessaire — VÉRIFIE le champ exact utilisé par ownerPortalService).
}
```

⚠️ AVANT d'écrire les sommes USD : lis `ownerPortalService.getOwnerCounters` pour reprendre EXACTEMENT la même colonne/ável de montant (`tax_amount_usd` ou équivalent) et la même conversion, afin de rester cohérent. Utilise `principal.supabase`/client staff — JAMAIS service-role.

- [ ] **Step 4 — Succès** (vitest ciblé).
- [ ] **Step 5 — Commit** : `feat(vision): service d'agrégation des 5 widgets`

---

## Task 6 : Page `/dashboard/vision` + UI `VisionBoard`

**Files:** Create `frontend/src/app/(dashboard)/dashboard/vision/page.tsx`, `frontend/src/components/dashboard/vision/VisionBoard.tsx`

- [ ] **Step 1 — Page (server component)**

```tsx
// vision/page.tsx
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { getServerActiveMode, modeFilter } from '@/lib/auth/activeMode';
import { getVisionCounters } from '@/services/visionService';
import { VisionBoard } from '@/components/dashboard/vision/VisionBoard';
import { redirect } from 'next/navigation';

export default async function VisionPage() {
  const principal = await requirePrincipal();
  if (principal.kind !== 'staff') redirect('/dashboard'); // opérateurs n'ont pas la vision board
  const mode = await getServerActiveMode();
  const counters = await getVisionCounters(principal.supabase, { mode: modeFilter(mode) });
  return <VisionBoard counters={counters} mode={mode} />;
}
```

- [ ] **Step 2 — UI `VisionBoard`** : lecture seule, AUCUNE action argent. Réutilise `OsStatCard`/`OsCard`/`OsTable` (primitives existantes). 5 surfaces : 2–3 stat cards (au port, en approche, payées 7j + impayées en cours avec montants USD) + une petite table « derniers départs ». i18n namespace `Vision`. Badge du mode actif (réutilise `ModeBadge` logique d'icône). Pas de mutation, pas de lien vers des actions d'écriture.

- [ ] **Step 3 — Vérifier** : `cd frontend && npx tsc --noEmit` propre + `npm run build` (la nouvelle route apparaît).
- [ ] **Step 4 — Commit** : `feat(vision): page /dashboard/vision lecture seule (5 widgets)`

---

## Task 7 : Réduire la nav MANAGER à la vision board

**Files:** Modify `rbac.ts`, `rbac.test.ts`, `DashboardSidebar.tsx`, `loginDestination.ts` (+ test), `(dashboard)/dashboard/page.tsx`

- [ ] **Step 1 — `rbac.ts`** : ajouter une clé `'vision': [UserRole.MANAGER, UserRole.SUPERADMIN]` dans `NAV_PERMISSIONS` (SUPERADMIN peut consulter aussi). **Retirer `UserRole.MANAGER` de TOUTES les autres clés** de `NAV_PERMISSIONS` et de `READ_ONLY_ROLES`. Résultat : MANAGER n'a accès qu'à `vision`.
- [ ] **Step 2 — `NAV_ITEMS` (`DashboardSidebar.tsx`)** : ajouter `{ key: 'vision', icon: <Eye/> (lucide), href: '/dashboard/vision', labelKey: 'nav_vision', section: 'ops' }` en tête de section ops. Le filtrage RBAC fera que MANAGER ne voit QUE cette entrée.
- [ ] **Step 3 — `loginDestination.ts`** : router MANAGER → `/dashboard/vision`. Ajouter le paramètre `role` déjà présent : `if (role === UserRole.MANAGER) return '/dashboard/vision';` (avant le fallback `/dashboard`). Mettre à jour le test (`loginDestination.test.ts`) : MANAGER → `/dashboard/vision` (retirer MANAGER du cas « staff → /dashboard »).
- [ ] **Step 4 — `(dashboard)/dashboard/page.tsx`** : si principal staff ET rôle MANAGER → `redirect('/dashboard/vision')` (un MANAGER qui atterrit sur l'overview est renvoyé vers sa vision). Récupère le rôle via `principal.user.role`.
- [ ] **Step 5 — `rbac.test.ts`** : mettre à jour les assertions MANAGER (ne doit plus accéder qu'à `vision` ; les anciennes clés deviennent refusées). Garder les assertions des autres rôles intactes.
- [ ] **Step 6 — Vérifier** : `cd frontend && npx tsc --noEmit && npx vitest run src/lib/__tests__/rbac.test.ts src/lib/auth/loginDestination.test.ts` verts.
- [ ] **Step 7 — Commit** : `feat(vision): MANAGER recentré sur la vision board (nav + routage)`

---

## Task 8 : i18n + gates finaux

- [ ] **Step 1 — i18n** : ajouter dans `frontend/messages/{en,fr,pt,sw,ar}.json` : `Dashboard.nav_vision`, le namespace `ModeSwitcher` (`label, both, maritime, air, error, retry`), le namespace `Vision` (titres des 5 widgets + libellés colonnes départs + « lecture seule » + libellés montants). Traductions réelles (pas de placeholder). FR soigné ; en/pt/sw/ar corrects.
- [ ] **Step 2 — Gates** :

Run: `cd frontend && npx tsc --noEmit && npm run test && npm run build`
Expected: tsc clean ; vitest vert (nouveaux tests activeMode/setActiveMode/ModeSwitcher/visionService/loginDestination/rbac) ; build OK (route `/dashboard/vision` présente).

- [ ] **Step 3 — Validation locales** : `for f in frontend/messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"; done` (tous parsent).
- [ ] **Step 4 — Commit final éventuel** : `feat(vision): i18n vision board + mode switcher`

---

## Critères de succès Phase 3

- Un MANAGER se connecte et atterrit sur `/dashboard/vision` ; sa sidebar ne montre QUE cette entrée ; aucune action d'écriture/argent accessible.
- La vision board affiche les 5 widgets (au port, en approche, derniers départs, payées 7j, impayées en cours) avec navires ET avions selon le mode actif.
- Admin & manager disposent du `ModeSwitcher` (maritime/aérien/les deux) ; la vision board respecte le mode actif ; auto-caché si la juridiction n'a qu'un mode.
- Le sélecteur de pays reste exposé pour admin & manager (déjà en place).
- Gates verts : tsc, vitest, build ; locales valides.

## Self-review (effectuée)

- **Couverture spec §5 P3** : vision board MANAGER ✓ (5 widgets), lecture seule ✓ (aucune mutation), filtre mode admin+manager ✓ (Tasks 1-4 + vision respecte), sélecteur pays ✓ (déjà exposé, confirmé). Vue « ensemble » multi-pays = hors scope (différée), conforme.
- **Placeholders** : code concret pour cookie/action/route/loginDestination ; `visionService` donne la forme + la liste exacte des statuts + l'avertissement de cohérence du montant USD (à aligner sur `ownerPortalService`). UI décrite via primitives existantes.
- **Cohérence types** : `ActiveMode` (`MARITIME|AIR|BOTH`) et `modeFilter()` (`→ 'MARITIME'|'AIR'|null`) cohérents entre Task 1, 5, 6. `VisionCounters` défini en Task 5, consommé en Task 6.
- **Sécurité** : vision board en client staff RLS (jamais service-role) ; `setActiveMode`/`getServerActiveMode` ne portent qu'une préférence d'affichage (le scope réel reste RLS + juridiction) ; MANAGER perd l'accès à toutes les autres surfaces via RBAC.
- **Portée mode** : filtrage mode limité à la vision board en P3 (autres listes staff = futur), explicitement documenté.
