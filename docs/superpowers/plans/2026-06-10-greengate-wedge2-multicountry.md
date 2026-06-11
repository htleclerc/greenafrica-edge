# GreenGate Wedge 2 — Multi-pays (Djibouti + tarification versionnée) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboarder la juridiction #2 (Djibouti, maritime + aviation, pool RLS) avec une table `tariffs` versionnée par (juridiction, mode, catégorie, dates) qui remplace les clés app_config globales, `revenue_split_rule` (D3), des géofences chargées depuis la DB (fin des polygones hardcodés Somaliland), le stamping de juridiction résolu depuis la géofence matchée, un switcher de juridiction pour le staff multi-pays, et l'UI admin juridictions/tarifs.

**Architecture:** Tenant = juridiction (pool partagé, RLS `jurisdiction_id` — gate prouvé mig 073). Le calcul Go devient tariff-aware : `calculator[mode]` lit `tariffs` (lookup le plus spécifique : catégorie > NULL, fenêtre de dates, fail-closed — JAMAIS un montant 0 silencieux) et retourne `tariff_id` que les pipelines snapshotent sur `transactions`. Les géofences (EEZ/FIR/ports) deviennent des lignes DB (`geofences`) chargées avec cache 60s par le Go et l'ingest ADS-B TS ; la détection résout `jurisdiction_id` depuis le polygone matché au lieu du DEFAULT Somaliland.

**Tech Stack:** Supabase Postgres (migrations 080-082 + tests pg `.test.sql`), Go (backend/internal: tariff, geofence, tax, eez, corridor, reconcile), Next.js/TS (actions, API routes, admin UI Os*, next-intl 5 locales).

**Décisions verrouillées (ne pas re-débattre):** pays #2 = Djibouti (`DJ`, UUID fixe `00000000-0000-4000-8000-00000000444a`, devise DJF, locales fr/ar/en, maritime + aviation signés, tarif harmonisé 40 USD/tCO2) · isolation POOL · onboarding opérateurs admin-driven (pattern pré-seed AOC W1-E).

**OUT OF SCOPE (différé, ne pas implémenter):** analytics pan-africain · signup public multi-pays (résolution sous-domaine ; `registerShipowner`/`registerAirOperator` restent SO-default) · settlement automatisé du split (la table + seed + affichage suffisent) · ancrage on-chain tarifs/splits (colonnes `signature_hash` réservées) · modèle de visibilité multi-juridiction des `vessels` (un navire transitant SO et DJ garde sa juridiction-registre ; alerts/transactions portent la juridiction de l'évènement — limitation documentée).

**Ordre de déploiement (expand/contract):** migrations 080-082 s'appliquent AVANT le déploiement du Go tariff-aware (le Go fail-closed lit `tariffs` ; les seeds doivent exister). Même release : DB push puis Fly deploy.

**Gates par tâche:** chaque tâche = TDD, puis `go test ./... -p 1` (backend) ou `npx vitest run <fichiers>` + `npx tsc --noEmit` (frontend), commit atomique. Gates finaux Task 11.

---

### Task 1: Migration 080 — table `tariffs` versionnée + seed Somaliland + snapshot `transactions.tariff_id`

**Files:**
- Create: `supabase/migrations/080_greengate_tariffs_versioned.sql`
- Create: `supabase/tests/migrations/080_greengate_tariffs_versioned.test.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 080: GreenGate v8 Wedge 2 — versioned tariffs table
--
-- PRIX = méthodologie[mode](émissions) × tarif[juridiction, mode, catégorie, date].
-- Replaces the global app_config keys (carbon_tax.rate_usd_per_tco2 /
-- carbon_tax.air_rate_usd_per_tco2) as the rate source of truth. The Go calculator
-- becomes tariff-aware (fail-closed: no ACTIVE tariff row → error, never silent $0).
-- The app_config keys are left in place for rollback but are no longer read after
-- the Go deploy that ships with this migration.
--
-- Versioning rules (eng review 3A + D3 pattern):
--   • A row is a tariff VERSION: [effective_from, effective_to) ; effective_to NULL = current.
--   • asset_category NULL = applies to ALL categories of the mode (specific row wins).
--   • zone reserved (NULL = all zones) — schema aligned with the design doc, unused in v1 lookup.
--   • No overlapping ACTIVE windows per (jurisdiction, mode, category, zone) — exclusion constraint.
--   • signature_hash reserved for D2 anchoring (decision 3A: invoices only in v8).
--   • transactions snapshot tariff_id at issuance — issued invoices never change.
--
-- Seeds Somaliland MARITIME + AIR versions from the live app_config values so the
-- Go cutover is value-identical.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.tariffs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id  UUID NOT NULL REFERENCES public.jurisdictions(id),
  mode             public.transport_mode NOT NULL,
  asset_category   TEXT,                          -- NULL = all categories (specific wins)
  zone             TEXT,                          -- reserved (NULL = all zones)
  rate_per_tco2    NUMERIC(10,2) NOT NULL CHECK (rate_per_tco2 > 0),
  currency         CHAR(3) NOT NULL DEFAULT 'USD',
  effective_from   DATE NOT NULL,
  effective_to     DATE,                          -- NULL = current version
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  decree_ref       TEXT,
  signature_hash   TEXT,                          -- reserved: D2 anchoring seam (3A)
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- No overlapping ACTIVE windows per logical key. Casts to text for btree_gist safety.
  CONSTRAINT tariffs_no_overlap EXCLUDE USING gist (
    jurisdiction_id WITH =,
    (mode::text) WITH =,
    (COALESCE(asset_category, '*')) WITH =,
    (COALESCE(zone, '*')) WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (status = 'ACTIVE')
);

CREATE INDEX IF NOT EXISTS idx_tariffs_lookup
  ON public.tariffs (jurisdiction_id, mode, status, effective_from DESC);

-- Snapshot column: which tariff version priced this transaction.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS tariff_id UUID REFERENCES public.tariffs(id);

COMMENT ON COLUMN public.transactions.tariff_id IS
  'Tariff version used at issuance (GreenGate v8 W2). Snapshot — never updated after issue.';

-- RLS: rates are public decree info (read-all); writes = finance admins of the jurisdiction.
ALTER TABLE public.tariffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads tariffs" ON public.tariffs FOR SELECT USING (TRUE);

CREATE POLICY "finance admins write tariffs" ON public.tariffs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
              AND p.role IN ('FINANCE_ADMIN','SUPERADMIN'))
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
              AND p.role IN ('FINANCE_ADMIN','SUPERADMIN'))
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

-- Seed Somaliland from the LIVE app_config values (value-identical Go cutover).
INSERT INTO public.tariffs (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, status, decree_ref)
SELECT '00000000-0000-4000-8000-00000000534f', 'MARITIME',
       (value #>> '{}')::numeric, 'USD', CURRENT_DATE, 'ACTIVE', 'MOE&CC/mi/36/2026'
  FROM public.app_config WHERE key = 'carbon_tax.rate_usd_per_tco2'
ON CONFLICT DO NOTHING;

INSERT INTO public.tariffs (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, status, decree_ref)
SELECT '00000000-0000-4000-8000-00000000534f', 'AIR',
       (value #>> '{}')::numeric, 'USD', CURRENT_DATE, 'ACTIVE', 'MOE&CC/mi/36/2026'
  FROM public.app_config WHERE key = 'carbon_tax.air_rate_usd_per_tco2'
ON CONFLICT DO NOTHING;

-- DOWN:
-- ALTER TABLE public.transactions DROP COLUMN IF EXISTS tariff_id;
-- DROP TABLE IF EXISTS public.tariffs;
-- (btree_gist left installed; harmless)
```

Note d'implémentation : si la valeur app_config est stockée en JSON number (ex. `40`), `value #>> '{}'` extrait `'40'` → cast numeric OK. Vérifier sur la chaîne réelle au gate final ; si le format diffère (ex. `{"value":40}`), adapter l'extraction (`value->>'value'`).

- [ ] **Step 2: Écrire le test pg**

```sql
-- Test 080: versioned tariffs
BEGIN;

-- 1. Seeds: Somaliland MARITIME + AIR ACTIVE rows exist with positive USD rates
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM public.tariffs
   WHERE jurisdiction_id='00000000-0000-4000-8000-00000000534f'
     AND status='ACTIVE' AND effective_to IS NULL AND currency='USD' AND rate_per_tco2 > 0;
  IF n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED: expected 2 ACTIVE Somaliland tariff seeds (MARITIME+AIR), got %', n;
  END IF;
END $$;

-- 2. Exclusion constraint rejects an overlapping ACTIVE window (same key)
DO $$
BEGIN
  BEGIN
    INSERT INTO public.tariffs (jurisdiction_id, mode, rate_per_tco2, effective_from, status)
    VALUES ('00000000-0000-4000-8000-00000000534f', 'MARITIME', 55, CURRENT_DATE, 'ACTIVE');
    RAISE EXCEPTION 'TEST FAILED: overlapping ACTIVE tariff window was accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
END $$;

-- 3. A category-SPECIFIC row in the same window is allowed (different key)
DO $$
DECLARE tid UUID;
BEGIN
  INSERT INTO public.tariffs (jurisdiction_id, mode, asset_category, rate_per_tco2, effective_from)
  VALUES ('00000000-0000-4000-8000-00000000534f', 'MARITIME', 'TANKER', 60, CURRENT_DATE)
  RETURNING id INTO tid;
  DELETE FROM public.tariffs WHERE id = tid;
END $$;

-- 4. Versioning: closing the current row (effective_to) allows a successor
DO $$
DECLARE old_id UUID; new_id UUID;
BEGIN
  SELECT id INTO old_id FROM public.tariffs
   WHERE jurisdiction_id='00000000-0000-4000-8000-00000000534f' AND mode='AIR'
     AND asset_category IS NULL AND status='ACTIVE';
  UPDATE public.tariffs SET effective_to = CURRENT_DATE + 30 WHERE id = old_id;
  INSERT INTO public.tariffs (jurisdiction_id, mode, rate_per_tco2, effective_from)
  VALUES ('00000000-0000-4000-8000-00000000534f', 'AIR', 45, CURRENT_DATE + 30)
  RETURNING id INTO new_id;
  IF new_id IS NULL THEN RAISE EXCEPTION 'TEST FAILED: successor version rejected'; END IF;
END $$;

-- 5. transactions.tariff_id column exists (uuid, nullable FK)
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='transactions' AND column_name='tariff_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAILED: transactions.tariff_id missing'; END IF;
END $$;

-- 6. rate must be > 0 (fail-closed at the data layer too)
DO $$
BEGIN
  BEGIN
    INSERT INTO public.tariffs (jurisdiction_id, mode, rate_per_tco2, effective_from, status)
    VALUES ('00000000-0000-4000-8000-00000000534f', 'MARITIME', 0, CURRENT_DATE + 100, 'DRAFT');
    RAISE EXCEPTION 'TEST FAILED: zero rate accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
SELECT '080 versioned tariffs: PASS' AS test_result;
```

- [ ] **Step 3: Valider sur postgres jetable ou chaîne complète**

Si Docker/Supabase local tourne : `supabase db reset` puis `bash supabase/tests/run.sh migrations/080_greengate_tariffs_versioned.test.sql` → attendu `080 versioned tariffs: PASS`. Sinon : harness postgres jetable (initdb + stubs rôles/auth/profiles/jurisdictions(071) — pattern des sessions précédentes) ; appliquer 071 puis 080 puis le test. Pour le stub : seed `app_config` rows `('carbon_tax.rate_usd_per_tco2','40'::jsonb)` + `('carbon_tax.air_rate_usd_per_tco2','40'::jsonb)` avant 080.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/080_greengate_tariffs_versioned.sql supabase/tests/migrations/080_greengate_tariffs_versioned.test.sql
git commit -m "feat(wedge2): mig 080 versioned tariffs table + Somaliland seeds + tariff_id snapshot"
```

---

### Task 2: Go — package `internal/tariff` (lookup fail-closed, cache 60s)

**Files:**
- Create: `backend/internal/tariff/lookup.go`
- Create: `backend/internal/tariff/lookup_test.go`

- [ ] **Step 1: Écrire les tests (sqlmock — suivre le pattern des tests existants de `internal/emissions` ; vérifier avec `ls backend/internal/emissions/*_test.go` et reproduire le style : si les tests existants utilisent une vraie DB via TESTDATABASE_URL, faire pareil)**

Cas à couvrir :
```go
// 1. Specific category beats NULL category (TANKER row at 60 wins over NULL row at 40).
// 2. NULL-category fallback when no specific row.
// 3. Date-window selection: a closed old version [from, to) is not returned after `to`.
// 4. Fail-closed: no ACTIVE row for (jid, mode) → error containing "no active tariff".
// 5. Cache: second call within TTL does not re-query (verify via query counter / mock expectations).
```

- [ ] **Step 2: Implémentation**

```go
// Package tariff resolves the versioned carbon-tax rate for a jurisdiction + mode.
//
// PRIX = méthodologie[mode](émissions) × tarif[juridiction, mode, catégorie, date].
// Lookup is FAIL-CLOSED: a missing ACTIVE tariff is an error — never a silent $0
// (eng review fiscal rule). Most-specific match wins: a row with asset_category set
// beats the NULL (all-categories) row; latest effective_from wins within a window.
package tariff

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"
)

// Rate is the resolved tariff version.
type Rate struct {
	ID          string
	RatePerTCO2 float64
	Currency    string
}

// Store caches tariff lookups for ttl (mirrors appconfig.Reader's 60s cache).
type Store struct {
	db  *sql.DB
	ttl time.Duration

	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	rate      Rate
	fetchedAt time.Time
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db, ttl: 60 * time.Second, cache: map[string]cached{}}
}

// Lookup resolves the ACTIVE tariff for (jurisdictionID, mode, category) at time `at`.
// category may be "" (matches only the NULL all-categories row).
func (s *Store) Lookup(ctx context.Context, jurisdictionID, mode, category string, at time.Time) (Rate, error) {
	key := jurisdictionID + "|" + mode + "|" + category
	s.mu.Lock()
	if c, ok := s.cache[key]; ok && time.Since(c.fetchedAt) < s.ttl {
		s.mu.Unlock()
		return c.rate, nil
	}
	s.mu.Unlock()

	var r Rate
	err := s.db.QueryRowContext(ctx, `
		SELECT id, rate_per_tco2, currency
		  FROM public.tariffs
		 WHERE jurisdiction_id = $1
		   AND mode = $2::public.transport_mode
		   AND status = 'ACTIVE'
		   AND (asset_category IS NULL OR asset_category = $3)
		   AND effective_from <= $4
		   AND (effective_to IS NULL OR effective_to > $4)
		 ORDER BY (asset_category IS NOT NULL) DESC, effective_from DESC
		 LIMIT 1
	`, jurisdictionID, mode, category, at).Scan(&r.ID, &r.RatePerTCO2, &r.Currency)
	if err == sql.ErrNoRows {
		return Rate{}, fmt.Errorf("tariff: no active tariff for jurisdiction=%s mode=%s (fail-closed)", jurisdictionID, mode)
	}
	if err != nil {
		return Rate{}, fmt.Errorf("tariff: lookup: %w", err)
	}

	s.mu.Lock()
	s.cache[key] = cached{rate: r, fetchedAt: time.Now()}
	s.mu.Unlock()
	return r, nil
}
```

- [ ] **Step 3: `go test ./internal/tariff/ -p 1` → PASS, puis `go build ./...`**

- [ ] **Step 4: Commit**

```bash
git add backend/internal/tariff/
git commit -m "feat(wedge2): Go tariff store - versioned rate lookup, fail-closed, 60s cache"
```

---

### Task 3: Go — calculateurs tariff-aware (jurisdiction dans la requête, tariff_id dans le breakdown)

**Files:**
- Modify: `backend/internal/tax/calculator.go` (Input + Breakdown + Calculate)
- Modify: `backend/internal/tax/air.go` (AirBreakdown + Calculate)
- Modify: `backend/internal/tax/handler.go` (CalculateRequest + default jurisdiction)
- Modify: `backend/internal/tax/registry.go` (signature NewModeRegistry + passage tariff store)
- Modify: `backend/cmd/api/main.go` (wiring `tariff.NewStore(db)`)
- Modify/Test: tests existants `backend/internal/tax/*_test.go` (adapter) 

- [ ] **Step 1: Adapter les types.** `CalculateRequest` (handler.go) gagne `JurisdictionID string \`json:"jurisdiction_id,omitempty"\``. Dans `Calculate` (handler), après le default mode, ajouter :

```go
	if req.JurisdictionID == "" {
		// Expand-window default: pre-W2 callers don't send a jurisdiction yet.
		req.JurisdictionID = "00000000-0000-4000-8000-00000000534f" // Somaliland
	}
```

- [ ] **Step 2: Maritime.** `Input` gagne `JurisdictionID string`. `Breakdown` gagne :

```go
	TariffID       string `json:"tariff_id"`
	JurisdictionID string `json:"jurisdiction_id"`
	Currency       string `json:"currency"`
```

`Calculator` gagne le champ `tariffs *tariff.Store` (param de `NewCalculator(db, cfg, tariffs)`). Le bloc rate devient :

```go
	rate := 0.0
	tariffID := ""
	currency := "USD"
	if in.RateOverride != nil {
		rate = *in.RateOverride
	} else {
		t, err := c.tariffs.Lookup(ctx, in.JurisdictionID, "MARITIME", in.Category, time.Now())
		if err != nil {
			return Result{}, fmt.Errorf("tax: %w", err)
		}
		rate, tariffID, currency = t.RatePerTCO2, t.ID, t.Currency
	}
```

et le Breakdown rempli avec `TariffID: tariffID, JurisdictionID: in.JurisdictionID, Currency: currency`. Supprimer la lecture `c.cfg.GetFloat("carbon_tax.rate_usd_per_tco2")` (garder le champ cfg si utilisé ailleurs, sinon retirer l'import).

- [ ] **Step 3: Air.** Même pattern dans `air.go` : `airCalculator` gagne `tariffs *tariff.Store` ; remplacer `a.cfg.GetFloat("carbon_tax.air_rate_usd_per_tco2")` par `a.tariffs.Lookup(ctx, req.JurisdictionID, "AIR", req.ICAOType, time.Now())` (catégorie = ICAOType, permet un tarif par type d'avion plus tard ; le NULL-fallback matche aujourd'hui). `AirBreakdown` gagne les mêmes 3 champs json.

- [ ] **Step 4: Registry + maritimeMode.** `NewModeRegistry(db, cfg, tariffs)` ; `maritimeMode.Calculate` passe `JurisdictionID: req.JurisdictionID` dans `Input`. `handler.NewHandler` construit `tariff.NewStore(db)` et le passe (ou le reçoit du main — suivre le wiring existant de `main.go:35-36`, choisir l'injection depuis main).

- [ ] **Step 5: Tests.** Adapter les tests existants (`calculator_test.go`, `air_test.go` : ils utilisent RateOverride ou un mock du cfg — vérifier ; les cas RateOverride passent sans tariff store ; ajouter un cas par mode : lookup tariffs heureux + fail-closed). `go test ./... -p 1` → PASS. `go build ./...`.

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat(wedge2): Go calculators tariff-aware - jurisdiction in request, tariff_id in breakdown, fail-closed"
```

---

### Task 4: Migration 081 — `revenue_split_rule` (D3, append-only, séquestre par défaut)

**Files:**
- Create: `supabase/migrations/081_greengate_revenue_split_rule.sql`
- Create: `supabase/tests/migrations/081_greengate_revenue_split_rule.test.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 081: GreenGate v8 Wedge 2 — revenue_split_rule (decision D3)
--
-- Versioned, signed concessionaire/sovereign revenue split per jurisdiction.
-- D3 rules: append-only (a change = INSERT new row + close previous effective_to);
-- every invoice references the rule applicable at ISSUANCE date (settlement
-- application deferred — out of W2 scope). Initial value = 100% escrowed to the
-- sovereign until the Min. Finance agreement is formalised (prevents premature
-- settlement). signature_hash reserved for D2 anchoring (3A).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.revenue_split_rule (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id     UUID NOT NULL REFERENCES public.jurisdictions(id),
  effective_from      TIMESTAMPTZ NOT NULL,
  effective_to        TIMESTAMPTZ,                -- NULL = current rule
  concessionaire_pct  NUMERIC(5,2) NOT NULL CHECK (concessionaire_pct BETWEEN 0 AND 100),
  sovereign_pct       NUMERIC(5,2) NOT NULL CHECK (sovereign_pct BETWEEN 0 AND 100),
  contract_ref        TEXT NOT NULL,
  signature_hash      TEXT NOT NULL,
  signed_by           TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (concessionaire_pct + sovereign_pct = 100),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT revenue_split_no_overlap EXCLUDE USING gist (
    jurisdiction_id WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  )
);

-- Append-only enforcement (mirrors wallet_ledger discipline): the ONLY permitted
-- UPDATE is closing the current rule (effective_to: NULL → value). DELETE forbidden.
CREATE OR REPLACE FUNCTION public.revenue_split_rule_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'revenue_split_rule is append-only: DELETE forbidden';
  END IF;
  -- UPDATE: only effective_to may change, and only from NULL.
  IF NEW.jurisdiction_id    IS DISTINCT FROM OLD.jurisdiction_id
     OR NEW.effective_from     IS DISTINCT FROM OLD.effective_from
     OR NEW.concessionaire_pct IS DISTINCT FROM OLD.concessionaire_pct
     OR NEW.sovereign_pct      IS DISTINCT FROM OLD.sovereign_pct
     OR NEW.contract_ref       IS DISTINCT FROM OLD.contract_ref
     OR NEW.signature_hash     IS DISTINCT FROM OLD.signature_hash
     OR NEW.signed_by          IS DISTINCT FROM OLD.signed_by
     OR OLD.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'revenue_split_rule is append-only: only closing effective_to (NULL -> value) is allowed';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER revenue_split_rule_append_only
  BEFORE UPDATE OR DELETE ON public.revenue_split_rule
  FOR EACH ROW EXECUTE FUNCTION public.revenue_split_rule_guard();

-- RLS: contract-sensitive — staff of the jurisdiction read; SUPERADMIN writes.
ALTER TABLE public.revenue_split_rule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read split rules" ON public.revenue_split_rule FOR SELECT
  USING (public.is_admin_or_officer()
         AND jurisdiction_id = ANY(public.current_jurisdiction_ids()));

CREATE POLICY "superadmin writes split rules" ON public.revenue_split_rule FOR ALL
  USING (public.get_user_role() = 'SUPERADMIN')
  WITH CHECK (public.get_user_role() = 'SUPERADMIN');

-- Seed: Somaliland escrow rule (100% sovereign until Min. Finance agreement — D3).
INSERT INTO public.revenue_split_rule
  (jurisdiction_id, effective_from, concessionaire_pct, sovereign_pct, contract_ref, signature_hash, signed_by)
VALUES
  ('00000000-0000-4000-8000-00000000534f', NOW(), 0, 100, 'ESCROW_PENDING_MINFIN', 'PENDING', 'solide')
ON CONFLICT DO NOTHING;

-- DOWN:
-- DROP TRIGGER IF EXISTS revenue_split_rule_append_only ON public.revenue_split_rule;
-- DROP FUNCTION IF EXISTS public.revenue_split_rule_guard();
-- DROP TABLE IF EXISTS public.revenue_split_rule;
```

- [ ] **Step 2: Test pg** — couvrir : (1) seed SO existe avec 0/100 + effective_to NULL ; (2) CHECK somme=100 rejette 60/30 (`check_violation`) ; (3) chevauchement même juridiction rejeté (`exclusion_violation`) ; (4) UPDATE de `concessionaire_pct` rejeté par le trigger (attraper `others` et vérifier le message contient `append-only`) ; (5) DELETE rejeté ; (6) fermeture `effective_to` NULL→date autorisée puis INSERT successeur autorisé. Structure `BEGIN; DO $$...$$; ROLLBACK; SELECT '081 ...: PASS'` comme 080.

- [ ] **Step 3: Valider (db reset ou harness jetable : stubs + 071 + 081 + test) → PASS**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/081_greengate_revenue_split_rule.sql supabase/tests/migrations/081_greengate_revenue_split_rule.test.sql
git commit -m "feat(wedge2): mig 081 revenue_split_rule (D3) - versioned, append-only, escrow seed"
```

---

### Task 5: Migration 082 — table `geofences` + onboarding Djibouti complet

**Files:**
- Create: `supabase/migrations/082_greengate_geofences_djibouti.sql`
- Create: `supabase/tests/migrations/082_greengate_geofences_djibouti.test.sql`

- [ ] **Step 1: Écrire la migration.** Contenu (structure ; les polygones EXACTS ci-dessous) :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 082: GreenGate v8 Wedge 2 — geofences table + Djibouti onboarding
--
-- (a) geofences: DB-driven geofence registry (EEZ zones, FIR rings, corridor ports).
--     Replaces the hardcoded Go constants (eez.SomalilandZones, fir.SomalilandFIR,
--     corridor destinations) and the TS duplicate in /api/adsb/ingest. Loaded with a
--     60s cache by Go + TS; detection resolves jurisdiction_id from the matched ring
--     (no more SOMALILAND_JID hardcodes / column-DEFAULT stamping on detection paths).
--     Geometry: JSONB — rings: [{"lat":..,"lng":..},...] (closed); PORT: {"lat":..,"lng":..}.
--     ALL rings are APPROXIMATE (same caveat as W1) — refine against official ICAO FIR /
--     maritime boundaries before production billing.
--     De-overlap note: the seeded SO FIR west edge moves 42.5 -> 43.45 so the DJ FIR
--     (41.7–43.45) and SO FIR (43.45–49.5) abut instead of overlapping. The billing
--     airports (Hargeisa 44.06E, Berbera 45.01E) remain inside SO FIR.
-- (b) Djibouti jurisdiction (#2 signed: MARITIME + AIR): registry row (POOL),
--     activation matrix both-enabled, harmonised 40 USD/tCO2 tariffs, escrow split
--     rule, staff memberships (PORT_OFFICER/FINANCE_ADMIN/MANAGER only — NOT agents).
-- ─────────────────────────────────────────────────────────────────────────────
```

Table :

```sql
CREATE TABLE IF NOT EXISTS public.geofences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              TEXT NOT NULL UNIQUE,
  jurisdiction_id  UUID NOT NULL REFERENCES public.jurisdictions(id),
  mode             public.transport_mode NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('PORT_VICINITY','EEZ','TRANSIT_LANE','FIR','PORT')),
  name             TEXT NOT NULL,
  geometry         JSONB NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_geofences_active ON public.geofences (active, mode, kind);
ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads geofences" ON public.geofences FOR SELECT USING (TRUE);
CREATE POLICY "admins write geofences" ON public.geofences FOR ALL
  USING (public.is_admin_or_officer()) WITH CHECK (public.is_admin_or_officer());
```

Seeds Somaliland (copie EXACTE des constantes Go — `eez/detector.go:31-67`, `fir/detector.go:25-27` sauf bord ouest FIR 43.45, `corridor/watcher.go:25-26`), `jsonb` rings `[{"lat":..,"lng":..},...]` :

```sql
INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry) VALUES
('somaliland-port-berbera', '00000000-0000-4000-8000-00000000534f', 'MARITIME', 'PORT_VICINITY', 'Port of Berbera',
 '[{"lat":10.42,"lng":45.00},{"lat":10.42,"lng":45.08},{"lat":10.48,"lng":45.08},{"lat":10.48,"lng":45.00},{"lat":10.42,"lng":45.00}]'),
('somaliland-port-zeila', '00000000-0000-4000-8000-00000000534f', 'MARITIME', 'PORT_VICINITY', 'Port of Zeila',
 '[{"lat":11.33,"lng":43.44},{"lat":11.33,"lng":43.52},{"lat":11.39,"lng":43.52},{"lat":11.39,"lng":43.44},{"lat":11.33,"lng":43.44}]'),
('somaliland-eez', '00000000-0000-4000-8000-00000000534f', 'MARITIME', 'EEZ', 'Somaliland EEZ',
 '[{"lat":10.00,"lng":43.20},{"lat":10.00,"lng":51.50},{"lat":13.00,"lng":51.50},{"lat":12.50,"lng":49.00},{"lat":11.80,"lng":45.00},{"lat":11.50,"lng":43.20},{"lat":10.00,"lng":43.20}]'),
('somaliland-transit-aden', '00000000-0000-4000-8000-00000000534f', 'MARITIME', 'TRANSIT_LANE', 'Gulf of Aden Transit Corridor',
 '[{"lat":11.50,"lng":43.00},{"lat":11.50,"lng":51.50},{"lat":13.50,"lng":51.50},{"lat":13.50,"lng":43.00},{"lat":11.50,"lng":43.00}]'),
('somaliland-fir', '00000000-0000-4000-8000-00000000534f', 'AIR', 'FIR', 'Somaliland FIR (approx, de-overlapped west edge)',
 '[{"lat":7.5,"lng":43.45},{"lat":7.5,"lng":49.5},{"lat":11.8,"lng":49.5},{"lat":11.8,"lng":43.45},{"lat":7.5,"lng":43.45}]'),
('somaliland-dest-berbera', '00000000-0000-4000-8000-00000000534f', 'MARITIME', 'PORT', 'Berbera', '{"lat":10.43,"lng":45.02}'),
('somaliland-dest-zeila', '00000000-0000-4000-8000-00000000534f', 'MARITIME', 'PORT', 'Zeila', '{"lat":11.35,"lng":43.48}')
ON CONFLICT (ref) DO NOTHING;
```

Onboarding Djibouti (UUID fixe `00000000-0000-4000-8000-00000000444a` — 0x444A = "DJ") :

```sql
INSERT INTO public.jurisdictions (id, code, name, default_currency, data_plane, sovereign_region, regulator_name, locales, status)
VALUES ('00000000-0000-4000-8000-00000000444a', 'DJ', 'Republic of Djibouti', 'DJF', 'POOL', 'Djibouti', 'MEDD', ARRAY['fr','ar','en']::TEXT[], 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

-- Activation matrix: BOTH modes signed for Djibouti.
INSERT INTO public.jurisdiction_mode_config (jurisdiction_id, mode, enabled, methodology_id, geofence_ref, activated_at)
SELECT '00000000-0000-4000-8000-00000000444a', 'MARITIME', TRUE, m.id, 'djibouti-eez', NOW()
  FROM public.methodologies m WHERE m.mode='MARITIME' AND m.code='IMO_MEPC_364_79'
ON CONFLICT (jurisdiction_id, mode) DO NOTHING;
INSERT INTO public.jurisdiction_mode_config (jurisdiction_id, mode, enabled, methodology_id, geofence_ref, activated_at)
SELECT '00000000-0000-4000-8000-00000000444a', 'AIR', TRUE, m.id, 'djibouti-fir', NOW()
  FROM public.methodologies m WHERE m.mode='AIR' AND m.code='ICAO_LTO'
ON CONFLICT (jurisdiction_id, mode) DO NOTHING;

-- Djibouti geofences (APPROXIMATE; abut Somaliland at lng 43.20 maritime / 43.45 FIR).
INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry) VALUES
('djibouti-eez', '00000000-0000-4000-8000-00000000444a', 'MARITIME', 'EEZ', 'Djibouti EEZ (approx)',
 '[{"lat":11.20,"lng":42.40},{"lat":11.20,"lng":43.20},{"lat":12.80,"lng":43.20},{"lat":12.80,"lng":42.40},{"lat":11.20,"lng":42.40}]'),
('djibouti-port-djibouti', '00000000-0000-4000-8000-00000000444a', 'MARITIME', 'PORT_VICINITY', 'Port de Djibouti',
 '[{"lat":11.57,"lng":43.10},{"lat":11.57,"lng":43.18},{"lat":11.63,"lng":43.18},{"lat":11.63,"lng":43.10},{"lat":11.57,"lng":43.10}]'),
('djibouti-fir', '00000000-0000-4000-8000-00000000444a', 'AIR', 'FIR', 'Djibouti airspace (approx)',
 '[{"lat":10.90,"lng":41.70},{"lat":10.90,"lng":43.45},{"lat":12.80,"lng":43.45},{"lat":12.80,"lng":41.70},{"lat":10.90,"lng":41.70}]'),
('djibouti-dest-djibouti', '00000000-0000-4000-8000-00000000444a', 'MARITIME', 'PORT', 'Port de Djibouti', '{"lat":11.60,"lng":43.14}')
ON CONFLICT (ref) DO NOTHING;

-- Harmonised pan-African tariff (40 USD/tCO2) — both modes, admin-tunable after.
INSERT INTO public.tariffs (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, status, decree_ref)
VALUES ('00000000-0000-4000-8000-00000000444a', 'MARITIME', 40, 'USD', CURRENT_DATE, 'ACTIVE', 'DJ_CONCESSION_2026'),
       ('00000000-0000-4000-8000-00000000444a', 'AIR',      40, 'USD', CURRENT_DATE, 'ACTIVE', 'DJ_CONCESSION_2026')
ON CONFLICT DO NOTHING;

-- Escrow split rule (same D3 default as Somaliland).
INSERT INTO public.revenue_split_rule
  (jurisdiction_id, effective_from, concessionaire_pct, sovereign_pct, contract_ref, signature_hash, signed_by)
VALUES ('00000000-0000-4000-8000-00000000444a', NOW(), 0, 100, 'ESCROW_PENDING_DJ_MINFIN', 'PENDING', 'solide')
ON CONFLICT DO NOTHING;

-- Staff memberships: the central Solide ops team operates both concessions today.
-- STAFF ONLY (officers/finance/managers) — NOT SHIPPING_AGENT/SHIPOWNER (locals stay local).
INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id)
SELECT p.id, '00000000-0000-4000-8000-00000000444a'
  FROM public.profiles p
 WHERE p.role IN ('PORT_OFFICER','FINANCE_ADMIN','MANAGER') AND p.is_active = true
ON CONFLICT DO NOTHING;
```

Et le DOWN en commentaire (DELETE des seeds DJ + DROP TABLE geofences).

- [ ] **Step 2: Test pg** — couvrir : (1) juridiction DJ existe (id fixe, DJF, POOL, ACTIVE, locales fr/ar/en) ; (2) matrice DJ : MARITIME et AIR tous deux `enabled=TRUE` avec geofence_ref ; (3) tariffs DJ : 2 lignes ACTIVE à 40 USD ; (4) split DJ escrow 0/100 ; (5) geofences : ≥11 lignes actives, refs `somaliland-fir` + `djibouti-fir` présentes, anneaux fermés (premier point = dernier point — vérifier via `geometry->0 = geometry->(jsonb_array_length(geometry)-1)` pour les kinds non-PORT) ; (6) memberships DJ : présents pour staff actifs, ABSENTS pour rôle SHIPPING_AGENT (insérer un profil agent stub avant le test du backfill ? Non — la migration a déjà tourné ; vérifier qu'AUCUNE ligne user_jurisdictions DJ ne joint un profil SHIPPING_AGENT/SHIPOWNER).

- [ ] **Step 3: Valider (chaîne complète de préférence : 082 dépend de 071+080+081) → PASS**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/082_greengate_geofences_djibouti.sql supabase/tests/migrations/082_greengate_geofences_djibouti.test.sql
git commit -m "feat(wedge2): mig 082 geofences table + Djibouti onboarding (jurisdiction, matrix, tariffs, split, staff)"
```

---

### Task 6: Go — package `internal/geofence` + détection multi-juridiction (stamping résolu)

**Files:**
- Create: `backend/internal/geofence/store.go`
- Create: `backend/internal/geofence/store_test.go`
- Modify: `backend/internal/eez/tracker.go` (injection store + stamping jurisdiction)
- Modify: `backend/internal/corridor/watcher.go` (ports depuis DB + stamping)
- Modify: `backend/internal/reconcile/sweeper.go:60` (zone via store)
- Modify: `backend/cmd/api/main.go` (wiring)

- [ ] **Step 1: Écrire `store.go`**

```go
// Package geofence loads jurisdiction geofences (EEZ zones, FIR rings, corridor
// ports) from public.geofences and resolves (zone, jurisdiction) for a position.
// Replaces the hardcoded Somaliland constants in internal/eez, internal/fir and
// internal/corridor — detection now works for every ACTIVE jurisdiction and the
// matched ring determines the jurisdiction_id stamped on alerts (no more
// column-DEFAULT stamping on detection paths).
package geofence

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// Kind values mirror the geofences.kind CHECK constraint.
const (
	KindPortVicinity = "PORT_VICINITY"
	KindEEZ          = "EEZ"
	KindTransitLane  = "TRANSIT_LANE"
	KindFIR          = "FIR"
	KindPort         = "PORT"
)

type Point struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type Geofence struct {
	ID             string
	Ref            string
	JurisdictionID string
	Mode           string
	Kind           string
	Name           string
	Ring           []Point // polygon kinds
	Point          Point   // KindPort
}

type Store struct {
	db  *sql.DB
	ttl time.Duration

	mu        sync.Mutex
	cached    []Geofence
	fetchedAt time.Time
}

func NewStore(db *sql.DB) *Store { return &Store{db: db, ttl: 60 * time.Second} }

func (s *Store) all(ctx context.Context) ([]Geofence, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cached != nil && time.Since(s.fetchedAt) < s.ttl {
		return s.cached, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, ref, jurisdiction_id, mode::text, kind, name, geometry
		  FROM public.geofences WHERE active = TRUE`)
	if err != nil {
		return nil, fmt.Errorf("geofence: load: %w", err)
	}
	defer rows.Close()
	var out []Geofence
	for rows.Next() {
		var g Geofence
		var geom []byte
		if err := rows.Scan(&g.ID, &g.Ref, &g.JurisdictionID, &g.Mode, &g.Kind, &g.Name, &geom); err != nil {
			return nil, fmt.Errorf("geofence: scan: %w", err)
		}
		if g.Kind == KindPort {
			if err := json.Unmarshal(geom, &g.Point); err != nil {
				return nil, fmt.Errorf("geofence: %s point geometry: %w", g.Ref, err)
			}
		} else {
			if err := json.Unmarshal(geom, &g.Ring); err != nil {
				return nil, fmt.Errorf("geofence: %s ring geometry: %w", g.Ref, err)
			}
		}
		out = append(out, g)
	}
	s.cached, s.fetchedAt = out, time.Now()
	return out, nil
}

// MaritimeMatch resolves the highest-priority maritime zone containing the point,
// across ALL active jurisdictions. ok=false when international waters.
func (s *Store) MaritimeMatch(ctx context.Context, lat, lng float64) (zone string, jurisdictionID string, ok bool, err error) {
	gfs, err := s.all(ctx)
	if err != nil {
		return "", "", false, err
	}
	for _, kind := range []string{KindPortVicinity, KindEEZ, KindTransitLane} {
		for _, g := range gfs {
			if g.Mode == "MARITIME" && g.Kind == kind && pointInRing(lat, lng, g.Ring) {
				return kind, g.JurisdictionID, true, nil
			}
		}
	}
	return "", "", false, nil
}

// FIRMatch resolves the jurisdiction whose FIR ring contains the point.
func (s *Store) FIRMatch(ctx context.Context, lat, lng float64) (jurisdictionID string, ok bool, err error) {
	gfs, err := s.all(ctx)
	if err != nil {
		return "", false, err
	}
	for _, g := range gfs {
		if g.Kind == KindFIR && pointInRing(lat, lng, g.Ring) {
			return g.JurisdictionID, true, nil
		}
	}
	return "", false, nil
}

// Ports returns the corridor destination ports of every active jurisdiction.
func (s *Store) Ports(ctx context.Context) ([]Geofence, error) {
	gfs, err := s.all(ctx)
	if err != nil {
		return nil, err
	}
	var out []Geofence
	for _, g := range gfs {
		if g.Kind == KindPort {
			out = append(out, g)
		}
	}
	return out, nil
}

// pointInRing implements the ray-casting algorithm (same as internal/eez).
func pointInRing(lat, lng float64, ring []Point) bool {
	inside := false
	n := len(ring)
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		yi, xi := ring[i].Lat, ring[i].Lng
		yj, xj := ring[j].Lat, ring[j].Lng
		if (xi > lng) != (xj > lng) &&
			lat < (yj-yi)*(lng-xi)/(xj-xi)+yi {
			inside = !inside
		}
	}
	return inside
}
```

- [ ] **Step 2: Tests `store_test.go`** — suivre le pattern DB des tests Go existants (regarder `backend/internal/eez/tracker_test.go:43` pour savoir comment ils obtiennent `db` ; reproduire). Cas : (1) MaritimeMatch priorité PORT_VICINITY>EEZ (point dans Berbera → PORT_VICINITY + jid SO) ; (2) point dans DJ EEZ → ("EEZ", jid DJ) ; (3) point océan Indien sud → ok=false ; (4) FIRMatch Hargeisa (9.56, 44.08) → SO ; aéroport Djibouti (11.55, 43.16) → DJ ; (5) Ports retourne 3 ports (2 SO + 1 DJ). Si les tests existants utilisent une DB de test seedée, insérer les geofences de test dans le setup.

- [ ] **Step 3: Rewire `eez/tracker.go`.** `NewTracker(db *sql.DB, gfs *geofence.Store)` ; dans `OnPosition`, remplacer `now := Detect(p.Lat, p.Lng)` par :

```go
	zoneStr, jid, matched, derr := t.gfs.MaritimeMatch(ctx, p.Lat, p.Lng)
	if derr != nil {
		return Event{}, fmt.Errorf("eez tracker: geofence match: %w", derr)
	}
	now := ZoneInternational
	if matched {
		now = Zone(zoneStr)
	}
```

et le INSERT rétroactif (ligne ~92) stampe la juridiction résolue : ajouter la colonne `jurisdiction_id` + valeur `jid` au INSERT (si `matched` est faux on n'est pas dans le bloc `entered`, donc `jid` est toujours valide ici). L'UPDATE→ARRIVED ne change pas (l'alerte existante porte déjà sa juridiction).

- [ ] **Step 4: Rewire `corridor/watcher.go`.** `New(db, cfg, gfs)` ; supprimer `var destinations` ; dans `Evaluate`, remplacer la boucle destinations par :

```go
	ports, perr := w.gfs.Ports(ctx)
	if perr != nil {
		return "", fmt.Errorf("corridor: load ports: %w", perr)
	}
	bestDist := math.MaxFloat64
	bestJID := ""
	for _, d := range ports {
		if dist := geo.HaversineNM(p.Lat, p.Lng, d.Point.Lat, d.Point.Lng); dist < bestDist {
			bestDist, bestJID = dist, d.JurisdictionID
		}
	}
```

et le INSERT d'alerte gagne la colonne `jurisdiction_id` avec `bestJID`.

- [ ] **Step 5: Rewire `reconcile/sweeper.go:60`** — `zone := eez.Detect(p.lat, p.lng)` devient un appel au store (injecter `gfs` dans la struct du sweeper, mapper `("", false)` → `ZoneInternational`). Lire le fichier pour l'injection exacte.

- [ ] **Step 6: Wiring `cmd/api/main.go`** — `gfs := geofence.NewStore(db)` avant les lignes 35-36 ; passer aux constructeurs modifiés. `go build ./...` puis `go test ./... -p 1` → PASS (adapter les tests des packages modifiés : ils devront seed `geofences` ou injecter un store sur la DB de test).

**Note :** garder `eez.Detect`/`fir.Detect`/`SomalilandZones` en place (utilisés par d'anciens tests + documentation des données source) avec un commentaire `// Deprecated: production paths read public.geofences via internal/geofence.`

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat(wedge2): DB-driven geofences - multi-jurisdiction detection + resolved jurisdiction stamping"
```

---

### Task 7: Frontend — ingest ADS-B multi-juridiction

**Files:**
- Modify: `frontend/src/app/api/adsb/ingest/route.ts`
- Test: `frontend/src/app/api/adsb/ingest/route.test.ts` (existe ? `ls` ; sinon créer)

- [ ] **Step 1: Refactor.** Supprimer `SOMALILAND_JID`, `SOMALILAND_FIR`, `pointInFIR`. Ajouter un cache module-level des FIR :

```ts
// FIR geofences loaded from public.geofences (mig 082) — module-level 60s cache.
// Detection resolves jurisdiction_id from the matched ring (multi-jurisdiction).
type FirRing = { jurisdiction_id: string; ring: Array<{ lat: number; lng: number }> };
let firCache: { fetchedAt: number; firs: FirRing[] } | null = null;
const FIR_CACHE_TTL_MS = 60_000;

async function loadFIRs(admin: ReturnType<typeof createPlatformClient>): Promise<FirRing[]> {
  if (firCache && Date.now() - firCache.fetchedAt < FIR_CACHE_TTL_MS) return firCache.firs;
  const { data, error } = await admin
    .from('geofences')
    .select('jurisdiction_id, geometry')
    .eq('kind', 'FIR')
    .eq('active', true);
  if (error || !data) throw new Error(`adsb: FIR geofence load failed: ${error?.message}`);
  const firs = data.map((g) => ({
    jurisdiction_id: g.jurisdiction_id as string,
    ring: g.geometry as Array<{ lat: number; lng: number }>,
  }));
  firCache = { fetchedAt: Date.now(), firs };
  return firs;
}

function matchFIR(lat: number, lng: number, firs: FirRing[]): string | null {
  for (const f of firs) {
    if (pointInRing(lat, lng, f.ring)) return f.jurisdiction_id;
  }
  return null;
}

function pointInRing(lat: number, lng: number, poly: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const yi = poly[i].lat, xi = poly[i].lng, yj = poly[j].lat, xj = poly[j].lng;
    if (xi > lng !== xj > lng && lat < ((yj - yi) * (lng - xi)) / (xj - xi) + yi) inside = !inside;
  }
  return inside;
}
```

Dans le handler : `const firs = await loadFIRs(admin);` (une fois, avant la boucle ; si le load échoue → 500, fail-closed). Par position : `const matchedJid = matchFIR(pos.lat, pos.lng, firs); const inFir = matchedJid !== null;`. Le GHOST operator insert utilise `jurisdiction_id: matchedJid ?? SOMALILAND_FALLBACK` — NON : GHOST créé seulement à partir d'une position ; si hors FIR, garder le comportement actuel (GHOST créé avec… aujourd'hui il est créé inconditionnellement avec SO). Décision : créer le GHOST avec `matchedJid` quand inFir, sinon laisser le DEFAULT colonne (opérateur hors juridiction = registre par défaut) — implémenter : construire l'objet insert et n'ajouter `jurisdiction_id: matchedJid` que si non-null. L'alerte (créée seulement si `inFir`) stampe toujours `jurisdiction_id: matchedJid`.

- [ ] **Step 2: Tests vitest** — mocker `@/lib/supabase/tenant` (pattern des tests cron) avec une table `geofences` retournant 2 FIR (SO ring est, DJ ring ouest) : (1) position dans le ring DJ → alerte créée avec `jurisdiction_id` DJ ; (2) position dans le ring SO → SO ; (3) position hors des deux → pas d'alerte, `in_fir=false` ; (4) échec du load geofences → 500.

- [ ] **Step 3: `npx vitest run src/app/api/adsb/ingest/` + `npx tsc --noEmit` → PASS**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/adsb/ingest/
git commit -m "feat(wedge2): adsb ingest resolves jurisdiction from DB FIR geofences (multi-country)"
```

---

### Task 8: Frontend — pipelines passent `jurisdiction_id` au Go + snapshot `tariff_id`

**Files:**
- Modify: `frontend/src/services/proformaPipelineService.ts` (chemins maritime ~119-187 et air ~380-420)
- Modify: `frontend/src/services/reconcilePipelineService.ts` (~148-280)
- Tests: les tests existants de ces services (adapter les fixtures du mock de réponse Go)

- [ ] **Step 1:** Dans chaque appel `POST /api/v1/tax/calculate` : ajouter `jurisdiction_id: alert.jurisdiction_id` au body (le select de l'alerte doit inclure `jurisdiction_id` — l'ajouter aux colonnes sélectionnées). Pour le chemin AIR, garder aussi le comportement existant.

- [ ] **Step 2:** Dans chaque INSERT de transaction : ajouter `tariff_id: tax.breakdown.tariff_id ?? null` ET `jurisdiction_id: alert.jurisdiction_id` (le chemin maritime comptait sur le DEFAULT colonne — le stamping explicite met fin à cette dépendance ; le chemin air le fait déjà depuis aircraft, l'aligner sur l'alerte). Typage : étendre les types TS de breakdown (`tariff_id?: string; jurisdiction_id?: string; currency?: string`).

- [ ] **Step 3:** Adapter les tests des deux services (fixtures de breakdown Go : ajouter `tariff_id`) ; vérifier qu'un test assert le snapshot `tariff_id` sur l'insert. `npx vitest run src/services/` ciblé + `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/
git commit -m "feat(wedge2): pipelines pass jurisdiction to Go calc + snapshot tariff_id on transactions"
```

---

### Task 9: Frontend — switcher de juridiction (staff multi-pays)

**Files:**
- Modify: `frontend/src/lib/auth/tenantContext.ts` (lecture cookie pour staff multi-juri)
- Create: `frontend/src/actions/setActiveJurisdiction.ts`
- Create: `frontend/src/app/api/me/jurisdictions/route.ts`
- Create: `frontend/src/components/dashboard/layout/JurisdictionSwitcher.tsx`
- Modify: `frontend/src/components/dashboard/layout/DashboardSidebar.tsx` (montage du switcher)
- Tests: `frontend/src/lib/auth/tenantContext.test.ts` (étendre s'il existe, sinon créer), test du switcher

- [ ] **Step 1: Cookie + résolution.** Constante partagée `ACTIVE_JURISDICTION_COOKIE = 'gg-active-jid'` (exporter depuis tenantContext). Dans `_getServerJurisdictionIdImpl`, remplacer le bloc `ids.length > 1` :

```ts
    if (ids.length > 1) {
        const { cookies } = await import('next/headers');
        const cookieStore = await cookies();
        const active = cookieStore.get(ACTIVE_JURISDICTION_COOKIE)?.value;
        if (active && ids.includes(active)) {
            return active;
        }
        throw new Error(
            'getServerJurisdictionId: multi-jurisdiction user — select an active jurisdiction (switcher)'
        );
    }
```

- [ ] **Step 2: Action `setActiveJurisdiction.ts`** ('use server') : auth via `createClient()` (`@/lib/supabase/server`), Zod `{ jurisdictionId: z.string().uuid() }`, vérifier l'appartenance (`user_jurisdictions` contient (user, jid) — requête via le client session, RLS "user reads own memberships" l'autorise), puis `cookies().set(ACTIVE_JURISDICTION_COOKIE, jid, { httpOnly: true, sameSite: 'lax', path: '/' })`. Retour `{ ok: true }` ou `{ ok: false, error }`. PAS de `export type` dans un fichier 'use server' (gotcha connu du repo).

- [ ] **Step 3: Route `GET /api/me/jurisdictions`** : auth session, lit `user_jurisdictions` joint `jurisdictions (id, code, name)` via le client session (RLS-self), + le cookie actif. Retour `{ memberships: [{id, code, name}], active: string | null }`.

- [ ] **Step 4: Composant `JurisdictionSwitcher.tsx`** ('use client') : fetch `/api/me/jurisdictions` au mount ; si `memberships.length <= 1` → si 1, label statique (code + name, style small-caps DESIGN.md `text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]`), si 0 → null ; si >1 → `<select>` stylé tokens Os (ou OsSelect si compatible) ; onChange → `setActiveJurisdiction({jurisdictionId})` puis `router.refresh()`. i18n namespace `JurisdictionSwitcher` (label "Juridiction"), clés ×5 locales (en, fr, pt, sw, ar).

- [ ] **Step 5: Monter dans `DashboardSidebar.tsx`** — lire le fichier, insérer le switcher dans la zone haute (sous le logo), rendu compact compatible sidebar 56px (au hover-expand) ; si l'intégration sidebar est inadaptée après lecture, le monter dans le layout `(dashboard)` header — choisir le point d'ancrage qui existe réellement et le documenter dans le commit.

- [ ] **Step 6: Tests.** tenantContext : (1) multi-juri + cookie valide → retourne le cookie ; (2) multi-juri + cookie absent → throw "select an active jurisdiction" ; (3) multi-juri + cookie hors memberships → throw ; (4) mono-juri ignore le cookie. Mock `next/headers` cookies. `npx vitest run` ciblé + `npx tsc --noEmit` + `npx eslint` ciblé → PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/auth/ frontend/src/actions/setActiveJurisdiction.ts "frontend/src/app/api/me/jurisdictions/" frontend/src/components/dashboard/layout/ frontend/messages/
git commit -m "feat(wedge2): jurisdiction switcher - cookie-based active jurisdiction for multi-country staff"
```

---

### Task 10: Frontend — admin `/admin/jurisdictions` (registre + matrice + tarifs + split) & retrait de la table morte

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/jurisdictions/page.tsx`
- Create: `frontend/src/components/dashboard/admin/AdminJurisdictions.tsx`
- Create: `frontend/src/actions/createTariffVersion.ts`
- Create: `frontend/src/actions/toggleJurisdictionMode.ts`
- Modify: `frontend/src/lib/rbac.ts` (NAV_PERMISSIONS + entrée)
- Modify: `frontend/src/components/dashboard/layout/DashboardSidebar.tsx` (entrée nav, icône lucide `Globe2`)
- Modify: `frontend/messages/{en,fr,pt,sw,ar}.json` (namespace `AdminJurisdictions`)
- Modify: `frontend/src/components/dashboard/tax/CarbonTaxSettingsPage.tsx` (retirer la table morte `tax_configurations` + lien vers /admin/jurisdictions)
- Tests: vitest pour les 2 actions + le panel

- [ ] **Step 1: Actions.**

`toggleJurisdictionMode.ts` ('use server') : `requireRole([UserRole.SUPERADMIN])` (activation = niveau contrat) ; Zod `{ jurisdictionId: uuid, mode: z.enum(['MARITIME','AIR']), enabled: z.boolean() }` ; `createPlatformClient()` (control-plane global) ; UPDATE `jurisdiction_mode_config SET enabled=$, activated_at = CASE WHEN $ THEN NOW() ELSE activated_at END WHERE jurisdiction_id= AND mode=` ; audit_logs (action 'TRANSACTION_UPDATED', entity_type 'Jurisdiction', details_json `{event:'MODE_TOGGLED', mode, enabled}`).

`createTariffVersion.ts` ('use server') : `requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN])` ; Zod `{ jurisdictionId: uuid, mode: enum, ratePerTco2: z.number().positive(), assetCategory: z.string().min(1).optional(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), decreeRef: z.string().min(1) }` ; staff non-SUPERADMIN : vérifier l'appartenance via `getServerJurisdictionId()`-style (la juridiction cible ∈ memberships — réutiliser `assertAdminCanActOn(auth.user, jurisdictionId)` de `@/lib/auth/adminTenant`) ; `createPlatformClient()` puis séquence : (1) UPDATE la version courante (même clé jurisdiction/mode/category, status ACTIVE, effective_to IS NULL) → `effective_to = effectiveFrom` ; (2) INSERT la nouvelle ligne ACTIVE (`created_by: auth.user.id`). Si l'INSERT échoue sur `tariffs_no_overlap` → retourner `{ ok:false, error:'overlap' }` (l'UI affiche le message) ; audit log.

- [ ] **Step 2: Page + panel.** `page.tsx` (server component, `dynamic='force-dynamic'`) : requireRole-style gate (pattern de `admin/wallets/page.tsx` : session → profile.role ∈ SUPERADMIN/FINANCE_ADMIN/PORT_OFFICER sinon redirect) ; fetch via `createPlatformClient()` : jurisdictions + jurisdiction_mode_config + tariffs (ACTIVE + historique trié) + revenue_split_rule (courantes) ; passer au panel client.

`AdminJurisdictions.tsx` ('use client') — design verrouillé en review : **ligne par juridiction** (code + nom + devise + locales + statut OsBadge), **2 pills de mode** (OsBadge variant selon enabled : `paid` si ON / `exempt` si OFF, label `MARITIME`/`AIR` + date d'activation au title) cliquables (SUPERADMIN) → `toggleJurisdictionMode` + refresh ; par juridiction, sous-section tarifs : tarif ACTIF courant par mode (`40 USD/tCO2` + decree_ref + effective_from) + bouton « Nouvelle version » (SUPERADMIN/FINANCE_ADMIN) ouvrant un formulaire inline (rate, mode, category optionnelle, effectiveFrom date, decreeRef) → `createTariffVersion` ; gestion de l'erreur `overlap` (banner alert pattern DESIGN.md) ; split courant affiché read-only (`0% / 100% — ESCROW`). **Pas de grille de toggles générique** ; composer depuis `OsCard`/`OsBadge`/`OsButton`/`OsInput`. Tous les strings via `t('AdminJurisdictions.…')`.

- [ ] **Step 3: i18n ×5 + rbac + sidebar.** `NAV_PERMISSIONS['jurisdictions'] = [SUPERADMIN, FINANCE_ADMIN, PORT_OFFICER]` (lecture ; les mutations sont gardées par les actions) — lire `rbac.ts` pour la clé exacte attendue par la sidebar ; entrée sidebar icône `Globe2` à côté de tax-settings. Ajouter ~20 clés `AdminJurisdictions.*` dans les 5 fichiers de locale (en/fr complets, pt/sw/ar traduits au mieux — relecture native déjà trackée TODOS #3).

- [ ] **Step 4: Retirer la table morte.** Dans `CarbonTaxSettingsPage.tsx` : supprimer la section « tax rate configuration table » alimentée par `tax_configurations` (lignes ~172-270) et l'appel `getTaxConfigurations` ; la remplacer par un court panneau de lien vers `/admin/jurisdictions` (« Les tarifs par juridiction ont déménagé »). Ne PAS dropper la table SQL (hors scope, lecture seule historique). Adapter les tests existants de cette page s'ils existent.

- [ ] **Step 5: Tests.** Actions : (1) toggle refuse non-SUPERADMIN ; (2) toggle heureux écrit enabled+activated_at+audit ; (3) createTariffVersion refuse rôle non-finance ; (4) heureux : close+insert appelés avec les bons payloads ; (5) erreur overlap → `{ok:false,error:'overlap'}`. Panel : rend une ligne par juridiction + pills. `npx vitest run` ciblé + `npx tsc --noEmit` + eslint ciblé → PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/"(dashboard)"/admin/jurisdictions/ frontend/src/components/dashboard/admin/AdminJurisdictions.tsx frontend/src/actions/createTariffVersion.ts frontend/src/actions/toggleJurisdictionMode.ts frontend/src/lib/rbac.ts frontend/src/components/dashboard/layout/DashboardSidebar.tsx frontend/messages/ frontend/src/components/dashboard/tax/
git commit -m "feat(wedge2): /admin/jurisdictions - registry, activation matrix, versioned tariffs UI, split display"
```

---

### Task 11: Gates finaux + doc

**Files:**
- Modify: `docs/designs/GREENGATE_V8_MULTITENANT.md` (statut Wedge 2 + limitations connues)

- [ ] **Step 1: Chaîne DB complète.** `supabase start` (si éteint) puis `supabase db reset` (001→082) ; lancer TOUS les tests pg : `for f in supabase/tests/migrations/*.test.sql; do bash supabase/tests/run.sh "migrations/$(basename $f)" || echo "FAIL: $f"; done` → tous PASS (y compris régressions 071/073).
- [ ] **Step 2: Go.** `cd backend && go vet ./... && go test ./... -p 1` → PASS.
- [ ] **Step 3: Frontend.** `cd frontend && npx tsc --noEmit && npx vitest run && npx eslint src --max-warnings=0 || true` (eslint : zéro NOUVELLE erreur vs develop) et `npm run build` → green.
- [ ] **Step 4: Doc.** Mettre à jour le design doc : Wedge 2 livré (sections tarifs/géofences), limitations connues (vessels multi-juri, signup public SO-only, settlement différé), ordre de déploiement (migs avant Go/Vercel).
- [ ] **Step 5: Commit final + push + PR vers develop**

```bash
git add docs/
git commit -m "docs(wedge2): mark Wedge 2 delivered + known limitations + deploy ordering"
git push -u origin feat/greengate-wedge2-multicountry
gh pr create --base develop --title "GreenGate Wedge 2 - multi-pays: Djibouti onboarding + versioned tariffs" --body "..."
```

---

## Self-review (fait à l'écriture)

- **Couverture spec :** tariffs versionnée (T1-T3) ✓ · revenue_split D3 (T4) ✓ · onboarding Djibouti mer+air (T5) ✓ · géofences DB + stamping résolu (T5-T7) ✓ · switcher staff multi-pays (T9 — bloquant découvert en cadrage) ✓ · admin UI matrice+tarifs (T10) ✓ · fail-closed fiscal (T2/T3) ✓ · snapshot tariff_id (T1/T8) ✓ · gates (T11) ✓.
- **Risques notés :** format JSON app_config pour le seed 080 (vérif au gate) · style des tests Go DB (suivre l'existant) · point d'ancrage du switcher (sidebar vs header — décision à la lecture du fichier) · polygones DJ approximatifs (caveat documenté, même statut que W1).
- **Types cohérents :** `tariff.Store.Lookup` → `Rate{ID,RatePerTCO2,Currency}` utilisé tel quel en T3 ; `geofence.Store.{MaritimeMatch,FIRMatch,Ports}` utilisés tels quels en T6 ; cookie `gg-active-jid` partagé T9.
