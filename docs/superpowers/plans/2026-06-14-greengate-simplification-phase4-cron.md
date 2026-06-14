# Phase 4 — Cron quotidien de précalcul des proformas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Un cron quotidien `/api/cron/daily-precompute` qui balaie les alertes « en approche sans proforma » des juridictions/modes actifs et génère leurs proformas **idempotemment** — filet de sécurité garanti en plus du temps réel (Go + worker pgmq). **Livré DÉSACTIVÉ** : gardé par un flag `app_config` (`feature.daily_precompute_enabled`, OFF par défaut) + un mode `?dryRun=1` (preview sans écriture). Les dashboards lisent en direct → générer suffit à les rafraîchir.

**Architecture:** Route Next.js (runtime nodejs, dynamic) authentifiée par `Authorization: Bearer ${CRON_SECRET}` (pattern des crons existants). Client `createPlatformClient()` (service-role, cross-juridiction légitime). Lit le flag d'activation dans `app_config` ; si OFF → no-op. Sinon : charge les couples (juridiction ACTIVE, mode enabled), sélectionne les `arrival_alerts` actionnables sans proforma, et appelle `runProformaPipeline` (qui lit `alert.mode` → maritime/air, est fail-closed sur tarif manquant). Idempotence native : le pipeline n'accepte que `MATCHED_AUTO|CLAIMED|ESCALATED` et passe l'alerte en `PROFORMA_SENT` — un re-run exclut automatiquement les alertes déjà traitées.

**Tech Stack:** Next.js 16 App Router (route handler), TS strict, Supabase service-role, Vitest, Vercel Cron.

**Décisions PO :** cron livré inerte (flag OFF) ; activation = bascule manuelle du flag par le PO. Pas d'auto-activation. Pas de changement backend Go.

---

## Contexte vérifié (cartographie)

- **Garde cron** : `const expected = process.env.CRON_SECRET; if (!expected || authHeader !== \`Bearer ${expected}\`) return 401;` (pattern `overdue-alerts/route.ts` + `notification-email-loop/route.ts`).
- **Pipeline** : `runProformaPipeline({ alertId, adminClient, taxApiUrl, taxApiSecret?, dryRunEmail?, dryRunStorage? }): Promise<{ ok: boolean; reason?: string; ... }>` (`frontend/src/services/proformaPipelineService.ts`). `ACTIONABLE = {MATCHED_AUTO, CLAIMED, ESCALATED}` ; refuse tout autre statut (dont `PROFORMA_SENT`) → idempotence. Au succès : `transactions` (document_type=PROFORMA) + `arrival_alerts.status='PROFORMA_SENT', proforma_transaction_id=txn.id`. Fail-closed Go (422 tarif) → `{ok:false}` sans écriture.
- **Cible** : `arrival_alerts` où `status IN ('MATCHED_AUTO','CLAIMED','ESCALATED') AND proforma_transaction_id IS NULL`.
- **Go** : `taxApiUrl = process.env.AFRICGREEN_API_URL ?? 'http://127.0.0.1:8080'` ; secret `process.env.AFRICGREEN_API_SECRET ?? process.env.AIS_INGEST_SECRET ?? process.env.API_SECRET`.
- **Juridictions actives** : `jurisdictions.status='ACTIVE'` + `jurisdiction_mode_config.enabled=true` (deux SELECT via platform client, comme `admin/jurisdictions/page.tsx`).
- **Flag** : lu directement dans `app_config` (clé `feature.daily_precompute_enabled`, `value === true`), pattern du middleware (lecture PostgREST directe).
- **Dashboards** : `ownerPortalService`/`visionService`/`kpiService` lisent live → aucun cache à invalider.
- **vercel.json** : bloc `crons` (path + schedule), 3 crons déjà à `0 9 * * *`.

---

## File Structure

| Fichier | Action |
|---|---|
| `frontend/src/services/dailyPrecomputeService.ts` (+ `.test.ts`) | **Créer** — logique pure-ish : charge l'ensemble actif, sélectionne les alertes cibles, orchestre `runProformaPipeline` ; testable en injectant le client + un runner |
| `frontend/src/app/api/cron/daily-precompute/route.ts` (+ `route.test.ts`) | **Créer** — handler : auth, flag, dryRun, délègue au service |
| `frontend/vercel.json` | **Modifier** — enregistrer le cron (inerte tant que flag OFF) |
| `frontend/.env.example` | **Modifier** — documenter le flag + rappel des env (CRON_SECRET, AFRICGREEN_API_URL/SECRET) |

---

## Task 1 : Service `dailyPrecomputeService`

**Files:** Create `frontend/src/services/dailyPrecomputeService.ts` + `.test.ts`

Le service contient la logique testable. Il reçoit le client admin + un `runner` (le pipeline, injectable pour les tests) + des options.

- [ ] **Step 1 — Test (vitest, mock query builder + runner)**

Couvre : (a) flag OFF → `{ enabled:false, scanned:0, generated:0 }`, le runner n'est PAS appelé ; (b) flag ON + 2 alertes cibles → runner appelé 2× (alertIds corrects), `generated:2` ; (c) une alerte dont le runner renvoie `{ok:false, reason}` → comptée `failed`, pas `generated`, la boucle continue ; (d) `dryRun:true` → runner JAMAIS appelé, `scanned` = nb d'alertes cibles, `generated:0` ; (e) filtre actif : une alerte d'une juridiction/mode NON activé est exclue de `scanned`.

```typescript
// dailyPrecomputeService.test.ts — forme (mock createPlatformClient via vi.hoisted comme notification-email-loop.test.ts ; injecter le runner en option)
// runProformaPipeline est injecté via opts.runner pour isoler le test du Go backend.
```

- [ ] **Step 2 — Échec** : `cd frontend && npx vitest run src/services/dailyPrecomputeService.test.ts` → FAIL.

- [ ] **Step 3 — Implémenter**

```typescript
// dailyPrecomputeService.ts (forme attendue)
import type { SupabaseClient } from '@supabase/supabase-js';
import { runProformaPipeline } from '@/services/proformaPipelineService';

const ACTIONABLE_NO_PROFORMA = ['MATCHED_AUTO', 'CLAIMED', 'ESCALATED'];
const DEFAULT_CAP = 200;

export interface DailyPrecomputeResult {
  enabled: boolean;
  dryRun: boolean;
  scanned: number;
  generated: number;
  skipped: number;
  failed: Array<{ alertId: string; reason: string }>;
}

type Runner = (alertId: string) => Promise<{ ok: boolean; reason?: string }>;

export interface DailyPrecomputeOpts {
  admin: SupabaseClient;
  taxApiUrl: string;
  taxApiSecret?: string;
  dryRun?: boolean;
  cap?: number;
  /** Injectable for tests; defaults to runProformaPipeline bound to admin/taxApi. */
  runner?: Runner;
}

export async function runDailyPrecompute(opts: DailyPrecomputeOpts): Promise<DailyPrecomputeResult> {
  const { admin } = opts;
  // 1. Flag gate — feature.daily_precompute_enabled in app_config (value === true).
  const { data: flag } = await admin.from('app_config').select('value').eq('key', 'feature.daily_precompute_enabled').maybeSingle();
  if (flag?.value !== true) {
    return { enabled: false, dryRun: !!opts.dryRun, scanned: 0, generated: 0, skipped: 0, failed: [] };
  }
  // 2. Active (jurisdiction, mode) set.
  const [{ data: jurs }, { data: modes }] = await Promise.all([
    admin.from('jurisdictions').select('id').eq('status', 'ACTIVE'),
    admin.from('jurisdiction_mode_config').select('jurisdiction_id, mode').eq('enabled', true),
  ]);
  const activeJur = new Set((jurs ?? []).map((j) => j.id as string));
  const activePair = new Set((modes ?? []).filter((m) => activeJur.has(m.jurisdiction_id as string)).map((m) => `${m.jurisdiction_id}:${m.mode}`));
  // 3. Target alerts.
  const { data: alerts } = await admin
    .from('arrival_alerts')
    .select('id, jurisdiction_id, mode')
    .in('status', ACTIONABLE_NO_PROFORMA)
    .is('proforma_transaction_id', null)
    .limit(opts.cap ?? DEFAULT_CAP);
  const targets = (alerts ?? []).filter((a) => activePair.has(`${a.jurisdiction_id}:${a.mode}`));
  // 4. dry-run → just report.
  const result: DailyPrecomputeResult = { enabled: true, dryRun: !!opts.dryRun, scanned: targets.length, generated: 0, skipped: 0, failed: [] };
  if (opts.dryRun) return result;
  // 5. Generate (idempotent: PROFORMA_SENT is excluded by the filter + pipeline).
  const runner: Runner = opts.runner ?? ((alertId) => runProformaPipeline({ alertId, adminClient: admin, taxApiUrl: opts.taxApiUrl, taxApiSecret: opts.taxApiSecret }));
  for (const a of targets) {
    try {
      const r = await runner(a.id as string);
      if (r.ok) result.generated++;
      else { result.skipped++; result.failed.push({ alertId: a.id as string, reason: r.reason ?? 'unknown' }); }
    } catch (e) {
      result.failed.push({ alertId: a.id as string, reason: e instanceof Error ? e.message : 'error' });
    }
  }
  return result;
}
```

- [ ] **Step 4 — Succès** : vitest ciblé vert.
- [ ] **Step 5 — Commit** : `feat(cron): service de précalcul quotidien des proformas (idempotent, flag-gated)`

---

## Task 2 : Route `/api/cron/daily-precompute`

**Files:** Create `frontend/src/app/api/cron/daily-precompute/route.ts` + `route.test.ts`

- [ ] **Step 1 — Test (mirror `notification-email-loop/route.test.ts`)** : (a) pas de `Authorization` → 401 ; (b) `CRON_SECRET` non défini → 401 (jamais "Bearer undefined") ; (c) Bearer valide + flag OFF (service renvoie enabled:false) → 200 `{enabled:false}` ; (d) Bearer valide + `?dryRun=1` → le service est appelé avec `dryRun:true` ; (e) Bearer valide normal → 200 avec le résultat du service. Mock `runDailyPrecompute` + `createPlatformClient`.

- [ ] **Step 2 — Échec.**
- [ ] **Step 3 — Implémenter**

```typescript
// route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { runDailyPrecompute } from '@/services/dailyPrecomputeService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  const admin = createPlatformClient();
  const result = await runDailyPrecompute({
    admin,
    taxApiUrl: process.env.AFRICGREEN_API_URL ?? 'http://127.0.0.1:8080',
    taxApiSecret: process.env.AFRICGREEN_API_SECRET ?? process.env.AIS_INGEST_SECRET ?? process.env.API_SECRET,
    dryRun,
  });
  return NextResponse.json({ success: true, ...result });
}
```

- [ ] **Step 4 — Succès** : vitest ciblé vert.
- [ ] **Step 5 — Commit** : `feat(cron): route /api/cron/daily-precompute (auth + dryRun)`

---

## Task 3 : Enregistrement Vercel Cron + doc env

**Files:** Modify `frontend/vercel.json`, `frontend/.env.example`

- [ ] **Step 1 — vercel.json** : ajouter au bloc `crons` (le cron est inerte tant que le flag est OFF ; planifié tôt pour que les proformas soient prêtes avant les heures de bureau) :

```json
{ "path": "/api/cron/daily-precompute", "schedule": "0 5 * * *" }
```

- [ ] **Step 2 — .env.example** : ajouter sous la section cron un rappel :

```
# Daily proforma precompute cron (/api/cron/daily-precompute).
# DISABLED by default: set app_config key feature.daily_precompute_enabled = true
# to activate. Uses CRON_SECRET (auth), AFRICGREEN_API_URL + AFRICGREEN_API_SECRET (Go calc).
# Preview without writing: GET /api/cron/daily-precompute?dryRun=1
```

- [ ] **Step 3 — Vérifier** : `node -e "JSON.parse(require('fs').readFileSync('frontend/vercel.json','utf8'))"` OK.
- [ ] **Step 4 — Commit** : `chore(cron): enregistrer daily-precompute (inerte tant que flag OFF) + doc env`

---

## Task 4 : Gates finaux

- [ ] **Step 1** :

Run: `cd frontend && npx tsc --noEmit && npm run test && npm run build`
Expected: tsc clean ; vitest vert (nouveaux tests service + route) ; build OK (route `/api/cron/daily-precompute` présente).

- [ ] **Step 2 — Commit final éventuel** si ajustements.

---

## Activation (runbook — pour le PO, hors code)

1. Vérifier `CRON_SECRET`, `AFRICGREEN_API_URL`, `AFRICGREEN_API_SECRET` en prod (Vercel env).
2. **Preview** : `GET /api/cron/daily-precompute?dryRun=1` (avec le Bearer) → vérifier `scanned` (nb d'alertes qui seraient traitées) sans rien écrire.
3. **Activer** : poser `app_config` `feature.daily_precompute_enabled = true` (via /admin ou SQL).
4. Le cron tourne chaque jour à 05:00 UTC ; surveiller `generated`/`failed` (les `failed` avec `tax api 422` = tarif manquant pour une juridiction/mode = fail-closed attendu).
5. **Désactiver** : remettre le flag à `false` (no-op immédiat).

## Critères de succès Phase 4

- Cron présent, authentifié (`CRON_SECRET`), **inerte par défaut** (flag OFF → `{enabled:false}`).
- Flag ON → génère idempotemment les proformas des alertes actionnables sans proforma, scopé aux juridictions/modes actifs ; re-run sans doublon (PROFORMA_SENT exclu).
- `?dryRun=1` → preview du `scanned` sans écriture.
- Fail-closed tarif géré (comptés `failed`, pas de transaction).
- Dashboards rafraîchis automatiquement (lecture live).
- Gates verts : tsc, vitest, build ; vercel.json valide.

## Self-review (effectuée)

- **Couverture spec §5 P4** : cron quotidien ✓, balaie juridictions/modes actifs ✓, idempotent ✓ (statut d'alerte + filtre proforma_transaction_id NULL), rafraîchit le dashboard ✓ (lecture live). **Livré désactivé** ✓ (flag + dryRun) — au-delà du spec, demandé par le PO.
- **Placeholders** : code concret pour service + route + vercel.json. Le `runner` injectable rend le service testable sans Go.
- **Cohérence types** : `DailyPrecomputeResult` défini en Task 1, consommé en Task 2 ; `runProformaPipeline` signature conforme à la cartographie.
- **Sécurité** : `CRON_SECRET` avec garde `!expected` ; client platform service-role (cross-juridiction légitime pour un cron) ; aucune entrée utilisateur (sauf `dryRun` booléen).
- **Risque double-comptage** : exclu — filtre `proforma_transaction_id IS NULL` + pipeline refuse `PROFORMA_SENT` ; un actif déjà facturé n'est jamais re-traité.
