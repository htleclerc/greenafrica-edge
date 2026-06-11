# GreenGate Wedge 3 — Enforcement de la matrice + fondations du settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (a) `jurisdiction_mode_config.enabled` devient un VRAI gate : mode désactivé pour une juridiction ⇒ aucune nouvelle alerte/proforma (maritime Go + aérien TS) — les voyages en cours se terminent ; (b) fondations du settlement D3 : chaque transaction snapshot la règle de partage applicable à l'émission (`split_rule_id` + trigger DB) et une vue de reporting calcule concessionnaire/souverain par juridiction × mois × mode. Le décaissement réel reste différé (escrow en attente Min. Finance).

**Architecture:** Enforcement aux POINTS DE CRÉATION d'alertes (corridor watcher + tracker retroactive côté Go via un store `internal/modeconfig` caché 60s ; bloc alert-creation de l'ingest ADS-B côté TS), JAMAIS au calc (les réconciliations d'alertes pré-existantes doivent aboutir). Sémantique : disable = stop les NOUVELLES détections ; in-flight complète. Absence de ligne matrice = DISABLED (fail-closed). Settlement : trigger BEFORE INSERT sur `transactions` (SECURITY DEFINER) stampe `split_rule_id` depuis `revenue_split_rule` par (jurisdiction_id, date d'émission) — couvre TOUS les chemins d'insert sans toucher les pipelines ; vue `v_revenue_split_settlement` sur les transactions PAID (style mig 067).

**Tech Stack:** Supabase Postgres (migs 085-086 + tests pg), Go (internal/modeconfig + corridor/eez), Next.js/TS (adsb ingest, /admin/jurisdictions), next-intl ×5.

**Branch:** `feat/greengate-wedge3-enforcement-settlement` (créée). Base : develop (W2 mergé, prod à 084).

**OUT OF SCOPE:** décaissement/virements du split (escrow) · convergence du simulateur legacy · re-résolution corridor provisoire · signup public multi-pays · analytics pan-africain · promotion silo.

**Gates par tâche:** TDD ; migrations validées sur chaîne locale (`supabase db reset` — Docker fonctionne) ou harness jetable ; `go test ./... -p 1` ; vitest/tsc/eslint ciblés ; commit atomique auteur "Loïc Leclerc <leclerc@drwintech.com>", JAMAIS de Co-Authored-By.

---

### Task 1: Mig 085 — snapshot `split_rule_id` sur transactions (trigger + backfill)

**Files:** Create `supabase/migrations/085_greengate_transactions_split_rule.sql` + `supabase/tests/migrations/085_greengate_transactions_split_rule.test.sql`

- [ ] **Step 1: Migration** (header maison ; contenu) :

```sql
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS split_rule_id UUID REFERENCES public.revenue_split_rule(id);
COMMENT ON COLUMN public.transactions.split_rule_id IS
  'Revenue split rule applicable at ISSUANCE (D3). Stamped by trigger at INSERT — never updated after issue. NULL = unattributed (no rule covered the issuance date; settlement view flags it).';

-- SECURITY DEFINER: revenue_split_rule a une RLS de lecture staff-only ; le stamping
-- doit fonctionner pour tout chemin d'insert (service-role, Go via pool, legacy).
CREATE OR REPLACE FUNCTION public.transactions_stamp_split_rule()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.split_rule_id IS NULL THEN
    SELECT r.id INTO NEW.split_rule_id
      FROM public.revenue_split_rule r
     WHERE r.jurisdiction_id = NEW.jurisdiction_id
       AND r.effective_from <= COALESCE(NEW.created_at, NOW())
       AND (r.effective_to IS NULL OR r.effective_to > COALESCE(NEW.created_at, NOW()))
     LIMIT 1;   -- l'exclusion-constraint de mig 081 garantit au plus une règle par instant
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transactions_stamp_split_rule
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_stamp_split_rule();

-- Backfill: résout par created_at (les tx antérieures au 2026-03-31 restent NULL — flaggées par la vue).
UPDATE public.transactions t
   SET split_rule_id = r.id
  FROM public.revenue_split_rule r
 WHERE t.split_rule_id IS NULL
   AND r.jurisdiction_id = t.jurisdiction_id
   AND r.effective_from <= t.created_at
   AND (r.effective_to IS NULL OR r.effective_to > t.created_at);

-- DOWN: DROP TRIGGER transactions_stamp_split_rule ON public.transactions;
--       DROP FUNCTION public.transactions_stamp_split_rule();
--       ALTER TABLE public.transactions DROP COLUMN IF EXISTTS split_rule_id;  -- (DESTRUCTIVE: perd l'attribution d'émission)
```
(corriger la typo IF EXISTTS → IF EXISTS dans le DOWN.)

- [ ] **Step 2: Test pg** (BEGIN/ROLLBACK, final `SELECT '085 transactions split rule: PASS'`) : (1) insert tx SO (vessel stub nécessaire ? lire les NOT NULL de transactions — utiliser les colonnes minimum comme les tests existants 026/077) → split_rule_id = la règle escrow SO ; (2) insert tx DJ → règle DJ ; (3) insert avec split_rule_id explicite → préservé ; (4) insert avec created_at '2026-01-01' (antérieur aux règles) → NULL ; (5) backfill vérifié (insérer une tx avec trigger désactivé ? non — le backfill a déjà tourné à l'apply ; tester en désactivant le trigger, insérant, réactivant, ré-exécutant l'UPDATE de backfill → stampée).
- [ ] **Step 3: Valider** — `supabase db reset` + `bash supabase/tests/run.sh migrations/085_greengate_transactions_split_rule.test.sql` → PASS (+ relancer 080/081/082 en régression rapide). Harness jetable en repli (071→084 + 085).
- [ ] **Step 4: Commit** `feat(wedge3): mig 085 split_rule_id snapshot on transactions - issuance-date stamping trigger + backfill`

### Task 2: Mig 086 — vue de reporting settlement

**Files:** Create `supabase/migrations/086_greengate_settlement_view.sql` + test.

- [ ] **Step 1: Migration** — vue read-only style mig 067 :
```sql
CREATE OR REPLACE VIEW public.v_revenue_split_settlement AS
SELECT j.id   AS jurisdiction_id,
       j.code AS jurisdiction_code,
       date_trunc('month', t.created_at)::date AS month,
       t.mode,
       count(*)                                  AS tx_count,
       sum(t.tax_amount_usd)                     AS total_usd,
       sum(t.tax_amount_usd * r.concessionaire_pct / 100.0) AS concessionaire_usd,
       sum(t.tax_amount_usd * r.sovereign_pct / 100.0)      AS sovereign_usd,
       count(*) FILTER (WHERE t.split_rule_id IS NULL)      AS unattributed_count
  FROM public.transactions t
  JOIN public.jurisdictions j ON j.id = t.jurisdiction_id
  LEFT JOIN public.revenue_split_rule r ON r.id = t.split_rule_id
 WHERE t.status = 'PAID'
 GROUP BY j.id, j.code, date_trunc('month', t.created_at), t.mode;
GRANT SELECT ON public.v_revenue_split_settlement TO service_role;
```
Note d'implémentation : les lignes unattributed (r NULL) donnent concessionnaire/souverain NULL dans les sommes — utiliser `sum(... ) FILTER (WHERE r.id IS NOT NULL)` ou COALESCE pour que total_usd reste complet et que les montants split n'incluent que l'attribué ; documenter dans le header. PAID = revenu collecté (le settlement ne s'applique qu'au collecté).
- [ ] **Step 2: Test pg** — seed un scénario (2 tx PAID SO 100 USD + 1 tx PAID DJ 50 + 1 PENDING ignorée + 1 PAID sans règle) → math : SO escrow 0/100 ⇒ concessionnaire 0 / souverain 200 ; DJ ⇒ 0/50 ; unattributed_count=1 ; PENDING absente. (Trigger 085 va auto-stamper — pour la tx « sans règle », created_at antérieur.)
- [ ] **Step 3: Valider** (db reset + test) → PASS. **Step 4: Commit** `feat(wedge3): mig 086 settlement reporting view (concessionaire/sovereign per jurisdiction-month-mode)`

### Task 3: Go — `internal/modeconfig` + gating corridor/tracker

**Files:** Create `backend/internal/modeconfig/store.go` (+ store_test.go) ; Modify `backend/internal/corridor/watcher.go`, `backend/internal/eez/tracker.go`, `backend/cmd/api/main.go` (+ tests).

- [ ] **Step 1: Store** (pattern tariff/geofence — cache 60s, mutex hors-IO) :
```go
// Package modeconfig answers "is (jurisdiction, mode) enabled?" from
// public.jurisdiction_mode_config. Detection entry points consult it so a
// disabled mode creates NO new alerts/proformas (in-flight voyages complete).
// FAIL-CLOSED: a missing row counts as DISABLED.
func NewStore(db *sql.DB) *Store        // ttl 60s
func (s *Store) Enabled(ctx context.Context, jurisdictionID, mode string) (bool, error)
```
Implémentation : un seul SELECT `jurisdiction_id::text, mode::text, enabled FROM public.jurisdiction_mode_config` chargé en map cache (comme geofence.all) ; `Enabled` lit la map (clé jid|mode, absent ⇒ false).
- [ ] **Step 2: Gating corridor** — dans `Evaluate`, après la résolution bestJID/bestDist (avant le calcul ETA/INSERT) :
```go
	on, merr := w.modes.Enabled(ctx, bestJID, "MARITIME")
	if merr != nil {
		return "", fmt.Errorf("corridor: mode config: %w", merr)
	}
	if !on {
		return "", nil // MARITIME disabled for this jurisdiction — no new detections.
	}
```
(`New(db, cfg, gfs, modes)` ; main.go construit `modeconfig.NewStore(db)` une fois.)
- [ ] **Step 3: Gating tracker** — dans le bloc `if entered` AVANT le flip/retroactive : si `!Enabled(jid,"MARITIME")` → log debug + SKIP le flip et le retroactive (mais laisser persistOK=true : on persiste last_zone — désactivé = silence intentionnel, pas de retry). Les blocs exited/UPDATE DEPARTED restent INCHANGÉS (in-flight complète).
- [ ] **Step 4: Tests** — store : enabled true/false/missing-row(false)/cache ; corridor : juridiction désactivée → pas d'alerte (seed la matrice du test DB : UPDATE enabled=false puis restore) ; tracker : entered sur juridiction désactivée → pas de flip ni retroactive, last_zone persisté. `go vet ./... && SUPABASE_DB_URL=... go test ./... -p 1` ALL PASS.
- [ ] **Step 5: Commit** `feat(wedge3): mode activation matrix enforced on maritime detection (corridor + tracker)`

### Task 4: TS — gating ingest ADS-B

**Files:** Modify `frontend/src/app/api/adsb/ingest/route.ts` (+ ses 2 fichiers de test).

- [ ] **Step 1:** Charger la matrice AIR avec le même pattern module-cache 60s que les FIRs (un seul fetch `jurisdiction_mode_config` select jurisdiction_id, mode, enabled eq mode AIR) → `airEnabled: Set<string>` ; échec de load ⇒ 500 fail-closed (même posture que loadFIRs — un seul guard commun). Dans le bloc `if (inFir)` : si `!airEnabled.has(matchedJid)` → skip la création d'alerte (compteur `alerts_skipped_disabled++`, exposé dans la réponse JSON) ; position + aircraft/ghost continuent (le registre vit, la facturation s'arrête).
- [ ] **Step 2: Tests** — (a) AIR désactivé pour la juridiction matchée → position insérée, AUCUNE alerte, compteur ; (b) activé → alerte (régression) ; (c) ligne matrice absente → pas d'alerte (fail-closed) ; (d) échec load matrice → 500 zéro insert. Adapter les mocks geofences existants (ajouter la table jurisdiction_mode_config au mock).
- [ ] **Step 3:** `npx vitest run src/app/api/adsb/ingest/ && npx tsc --noEmit && npx eslint` clean. **Commit** `feat(wedge3): adsb ingest enforces the air activation matrix (fail-closed)`

### Task 5: UI — settlement sur /admin/jurisdictions + disclosure mise à jour

**Files:** Modify `frontend/src/app/(dashboard)/admin/jurisdictions/page.tsx`, `frontend/src/components/dashboard/admin/AdminJurisdictions.tsx` (+ test), `frontend/messages/{en,fr,pt,sw,ar}.json`.

- [ ] **Step 1:** page.tsx fetch la vue `v_revenue_split_settlement` (platform client, order month desc) → prop settlement rows. Panel : par juridiction, sous la section split, un bloc « Settlement (collecté) » : mois courant + cumul — `total / concessionnaire / souverain` (format USD) + badge `unattributed` si count>0 ; vide → t('settlement.empty') (« Aucun revenu collecté »). PAS de nouvelle page ; composer Os*.
- [ ] **Step 2:** `modesDisclosure` ×5 locales devient : EN "Gates new detections and billing — in-flight voyages complete. Calc API itself stays open for reconciliation." (FR/PT/SW/AR équivalents). Ajouter le namespace settlement (~6 clés ×5).
- [ ] **Step 3:** tests panel (settlement affiché, empty state) ; vitest + tsc + eslint + build clean. **Commit** `feat(wedge3): settlement summary on /admin/jurisdictions + enforced-matrix disclosure`

### Task 6: CI — healthcheck découplé

**Files:** Modify `.github/workflows/deploy-production.yml`.

- [ ] **Step 1:** job healthcheck : `needs: [deploy, backend]` → `needs: [backend]` (le frontend prod passe par l'intégration Vercel native ; le check frontend via PRODUCTION_URL reste valable). Commentaire une ligne. **Commit** `fix(ci): health checks no longer depend on the opt-in Vercel job`

### Task 7: Gates finaux + doc + PR

- [ ] **Step 1:** `supabase db reset` (001→086) + TOUS les tests pg (régression complète ; tout doit passer comme à la release W2). **Step 2:** Go full (`go vet && go test ./... -p 1`). **Step 3:** frontend full (tsc, vitest run, eslint zéro nouvelle erreur, next build). **Step 4:** doc — design doc : limitations (1) enforcement → ✅ LIVRÉ W3 (sémantique : stop new, in-flight complète, calc ouvert) ; (7) settlement → fondations ✅ LIVRÉES W3 (snapshot + reporting ; décaissement toujours différé — escrow) ; ordre de déploiement : migs 085-086 avant le Go (le Go modeconfig lit la matrice — table existante depuis 071, donc pas de hard fail, mais même release recommandée). **Step 5:** commit doc + push + PR vers develop (titre "GreenGate Wedge 3 - enforcement matrice d'activation + fondations settlement").

## Self-review
- Couverture : enforcement Go (T3) + TS (T4) + sémantique documentée (T5/T7) ✓ ; settlement snapshot (T1) + reporting (T2) + UI (T5) ✓ ; CI mineur (T6) ✓.
- Types cohérents : `modeconfig.Store.Enabled(ctx, jid, mode) (bool, error)` utilisé tel quel T3 ; vue colonnes consommées telles quelles T5.
- Risques notés : NOT NULL de transactions pour les seeds des tests pg (lire les tests 026/077 existants) ; sommes NULL dans la vue (FILTER/COALESCE spécifié) ; mocks adsb à étendre (matrice).
