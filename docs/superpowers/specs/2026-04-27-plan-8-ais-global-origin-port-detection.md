# Plan 8 — AIS Global Origin-Port Detection (design)

**Date** : 2026-04-27
**Status** : Design approved by user 2026-04-27, awaiting execution plan
**Branch (to create)** : `feat/ais-global-v0` from `develop`
**Master spec reference** : [`2026-04-22-proactive-vessel-detection-and-proforma-design.md`](2026-04-22-proactive-vessel-detection-and-proforma-design.md) — implements Phase 2 item `feature.ais_global_enabled` (master spec §3 decision #2, §9 Phase 2).

---

## 1. Context

The MVP detects vessels via the **500 NM approach corridor around Berbera/Zeila** ([`backend/internal/corridor/watcher.go`](../../../backend/internal/corridor/watcher.go)). That gives roughly 2-4 days of lead time before EEZ entry — enough to send a pro-forma to the agent, but tight when the agent is unmapped and the alert lands UNCLAIMED.

Scenario A in the master spec extends detection to **the moment a vessel declares Berbera/Zeila as its destination at the origin port** (typically 1-3 weeks before arrival). This is gated behind `feature.ais_global_enabled` because:

- It requires global AIS coverage (currently the ingester subscribes to a Red Sea / Gulf of Aden / Arabian Sea bounding box only).
- It requires the `ShipStaticData` AIS message type (currently the ingester only listens to `PositionReport`).
- The `Destination` field in AIS-5 is free-text and sloppy — typos, abbreviations, multi-port hops — so naive substring matching produces false positives that would send pro-formas to the wrong agent.

This document specifies **how Plan 8 lights up scenario A safely**: zero-false-positive matching via an allow-list with human-in-the-loop fuzzy proposals, and zero blast radius on the existing corridor pipeline.

---

## 2. Goals & Non-Goals

### In scope
- Activate scenario A behind the existing flag `feature.ais_global_enabled` (defaults to `false`, runtime-toggleable).
- Subscribe to `ShipStaticData` globally; keep regional `PositionReport` subscription unchanged.
- Match the AIS `Destination` field against an admin-curated allow-list per port; fall back to a human-validated proposal flow for fuzzy matches.
- Every alert produced by scenario A starts in `UNCLAIMED` (never `MATCHED_AUTO`), regardless of any `owner_agent_mappings` cascade — humans always decide before a pro-forma is sent.

### Out of scope
- Scenario C (ENOAD / Notice of Arrival upload) — Plan 9.
- Cross-checking the AIS Destination against Equasis voyage data (Plan 7 stays independent).
- Paid aisstream.io tier provisioning. Free tier first, escalate post-rollout if metrics show throttling.
- Auto-cancel an alert when a vessel changes its Destination en route (open question §10.3 — explicit decision: do nothing, leave to PORT_OFFICER manual triage).
- Refactoring `corridor.Watcher`. Plan 8 adds a sibling module; corridor stays exactly as-is.

---

## 3. Decisions Summary

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Paid tier aisstream.io | Free tier, 2 WebSocket connections (Option A) | Defer cost until measured; existing regional WS unchanged |
| 2 | Destination matching strategy | Allow-list + fuzzy proposal review (Option C hybrid) | Zero false positives = zero wrong-agent pro-formas |
| 3 | Watcher integration | New module `backend/internal/originport/` (Option B) | Boundaries per detection scenario; corridor module stays untouched |
| 4 | Initial alert state for scenario A | Always `UNCLAIMED`, never auto-matched | 3000 NM lead time, info can change; human-in-loop is cheap insurance |
| 5 | Single shared `arrival_alerts` table | Yes, with new `detection_source` enum column | Downstream (claim, proforma, reconcile) reuses existing pipeline |
| 6 | `destination_match_proposals` separate from `equasis_scrape_proposals` | Separate table | Different columns, different review pattern |

---

## 4. Architecture

```
aisstream.io
  ├── WS1 — bbox monde (4 quadrants), FilterMessageTypes=ShipStaticData
  │     conditioned on feature.ais_global_enabled = true
  │     → originport.Watcher.OnStaticData(...)
  │
  └── WS2 — bbox Mer Rouge / Golfe d'Aden, FilterMessageTypes=PositionReport
        always on (existing)
        → corridor.Watcher.Evaluate(...)   UNCHANGED
        → eez.Tracker.OnPosition(...)      UNCHANGED

backend/internal/
├── ais/
│   └── ingester.go               MODIFIED — dual-WS dispatcher on MessageType
├── corridor/
│   └── watcher.go                UNCHANGED
├── originport/                   NEW
│   ├── watcher.go                OnStaticData → alert UNCLAIMED | proposal | drop
│   ├── matcher.go                matchDestination(text, ports) → MATCH | PROPOSE | NONE
│   ├── matcher_test.go
│   ├── cache.go                  MMSI→(IMO,Destination,seenAt) LRU, TTL 24h, in-memory
│   └── cache_test.go
└── eez/                          UNCHANGED
```

### Why a new module instead of branching `corridor.Watcher`

| | corridor (scenario B) | originport (scenario A, Plan 8) |
|---|---|---|
| Trigger | geo-fence proximity to Berbera/Zeila | string match on `Destination` field |
| Input | `PositionReport` (Lat/Lng/SOG) | `ShipStaticData` (IMO/Destination/ETA) |
| Frequency | every position (~1/min/vessel) | every static report (~1/6min/vessel), debounced 1/24h/IMO |
| Confidence | high (vessel is there) | low (crew declaration, may change) |
| Initial alert state | `DETECTED` → may auto-match | always `UNCLAIMED` |
| Distance to port | ≤500 NM, computed | ~3000 NM, unknown — column will be NULL |

Two distinct triggers, two distinct confidence profiles. A new module keeps boundaries clean and makes Plan 9 (NOA) a third sibling instead of a third branch.

### Isolation guarantee

`originport.Watcher` reads only from the AIS WebSocket message stream (and its own in-memory MMSI cache). It writes only to `arrival_alerts` and `destination_match_proposals`. **It never reads `vessel_positions` or any corridor/EEZ state.** A bug in Plan 8 cannot corrupt the corridor → EEZ → reconcile chain.

The existing partial unique index on `arrival_alerts (vessel_id) WHERE status NOT IN ('RECONCILED','CANCELLED')` guarantees no duplicates if the same IMO is detected first by scenario A then by scenario B. The second INSERT is silently swallowed (cf. [`watcher.go:91-93`](../../../backend/internal/corridor/watcher.go#L91)) and the alert continues with whichever scenario detected it first.

---

## 5. Data Model

### 5.1 Migration `043_arrival_alerts_detection_source.sql`

```sql
CREATE TYPE public.detection_source AS ENUM (
  'CORRIDOR_500NM',
  'ORIGINPORT',
  'NOA'
);

ALTER TABLE public.arrival_alerts
  ADD COLUMN detection_source public.detection_source NOT NULL DEFAULT 'CORRIDOR_500NM',
  ALTER COLUMN detected_lat        DROP NOT NULL,
  ALTER COLUMN detected_lng        DROP NOT NULL,
  ALTER COLUMN distance_to_port_nm DROP NOT NULL,
  ALTER COLUMN estimated_route_nm  DROP NOT NULL;

UPDATE public.arrival_alerts
  SET detection_source = 'CORRIDOR_500NM'
  WHERE detection_source IS NULL;

CREATE INDEX arrival_alerts_originport_unclaimed_idx
  ON public.arrival_alerts (created_at DESC)
  WHERE detection_source = 'ORIGINPORT' AND status = 'UNCLAIMED';
```

`NOA` is included in the enum now so Plan 9 doesn't have to `ALTER TYPE ... ADD VALUE` later (PostgreSQL forbids that inside a transaction in some configurations).

### 5.2 Migration `044_destination_match_proposals.sql`

```sql
CREATE TYPE public.destination_proposal_status
  AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE public.destination_match_proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mmsi               text NOT NULL,
  imo_number         text,
  vessel_name        text,
  raw_destination    text NOT NULL,
  normalized         text NOT NULL,
  matched_port_guess text,
  fuzzy_score        int  NOT NULL,
  status             public.destination_proposal_status NOT NULL DEFAULT 'PENDING',
  decided_by         uuid REFERENCES public.profiles(id),
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX destination_match_proposals_unique_pending_idx
  ON public.destination_match_proposals (mmsi, normalized)
  WHERE status = 'PENDING';

ALTER TABLE public.destination_match_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY destination_proposals_admin_read
  ON public.destination_match_proposals FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('SUPERADMIN','PORT_OFFICER','FINANCE_ADMIN')
  );

CREATE POLICY destination_proposals_admin_update
  ON public.destination_match_proposals FOR UPDATE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('SUPERADMIN','PORT_OFFICER')
  );

-- INSERT: service_role only (Go backend writes; humans don't insert)
```

Separate from `equasis_scrape_proposals` — different columns (destination text + fuzzy score vs owner email + manager) and different review semantics.

### 5.3 Migration `045_origin_port_allow_list_config.sql`

```sql
INSERT INTO public.app_config (key, value, description) VALUES
  ('arrival.origin_port_allow_list',
   '{
     "BERBERA": ["BERBERA","BBR","BERBA","BERBARA","SBE","SOMA BBR","SOMALILAND BERBERA"],
     "ZEILA":   ["ZEILA","ZEYLA","ZELA"]
    }'::jsonb,
   'Allow-list of AIS-5 Destination variants per port. Edited via /admin/tax-settings.
    Values UPPERCASE, no punctuation. Approving a fuzzy proposal auto-merges its
    normalized variant into this list.')
ON CONFLICT (key) DO NOTHING;
```

`ON CONFLICT DO NOTHING` because `app_config` may already have this key on hosted environments (see ROADMAP §B0 hosted-DB drift notes).

JSON-in-`app_config` rather than a dedicated table because:
- ~20-50 variants total, expected to stabilize within weeks
- Edited rarely (admins after reviewing proposals)
- Read on every static message → fits the `appconfig.Reader` cache pattern already in use

### 5.4 No new pgmq queues, no new pg_cron jobs

Plan 8 reuses the existing pipeline downstream of `arrival_alerts`. The agent-match cron will see `ORIGINPORT` alerts but the design forces them to `UNCLAIMED` regardless of mapping cascade — the cron should respect `detection_source` and not auto-match. **Implementation note for the plan**: the `agent-match` SQL function in [`supabase/migrations/034_agent_match_cron.sql`](../../../supabase/migrations/034_agent_match_cron.sql) needs a `WHERE detection_source != 'ORIGINPORT'` guard (added via a follow-up migration `046_agent_match_skip_originport.sql`), or the function should be patched directly to skip ORIGINPORT alerts entirely. Alerts with `detection_source='ORIGINPORT'` stay UNCLAIMED indefinitely until a human claims them.

---

## 6. Detection Flow

```
ShipStaticData arrives on WS1
  │
  ├── feature.ais_global_enabled = false  → drop
  │
  └── feature.ais_global_enabled = true
       │
       ├── IMO empty                       → drop
       │
       ├── matcher.matchDestination(Destination, allowList) →
       │
       │     ├── MATCH (variant in allow-list, post-normalization)
       │     │     │
       │     │     ├── Check debounce (existing partial unique idx + last 24h check)
       │     │     │     duplicate                  → drop
       │     │     │     fresh                      → INSERT arrival_alerts (
       │     │     │                                     status='UNCLAIMED',
       │     │     │                                     detection_source='ORIGINPORT',
       │     │     │                                     estimated_eta = AIS ETA decoded,
       │     │     │                                     detected_lat/lng = current MetaData pos,
       │     │     │                                     distance_to_port_nm = NULL,
       │     │     │                                     estimated_route_nm  = NULL)
       │     │     │                                  + INSERT audit_log
       │     │     │
       │     │     └── cache.Put(MMSI, IMO, Destination, now)
       │     │
       │     ├── PROPOSE (Levenshtein ≤ 2 against any canonical port name,
       │     │           AND not already in allow-list)
       │     │     │
       │     │     └── INSERT destination_match_proposals (status='PENDING')
       │     │           ON CONFLICT (mmsi, normalized) WHERE status='PENDING' DO NOTHING
       │     │
       │     └── NONE                       → drop silently
       │
       └── (no path else)
```

### Match algorithm details (`originport/matcher.go`)

1. **Normalize**: `strings.ToUpper(strings.TrimSpace(raw))`, then strip non-alphanumeric (keeping spaces). E.g. `"BBR>DJB"` → `"BBR DJB"`, `"Berbera, Somaliland"` → `"BERBERA SOMALILAND"`.
2. **Allow-list pass**: for each `(port, variants[])` in the config, return `MATCH(port)` if any variant is a substring of the normalized input. Substring (not equality) handles `"BERBERA SOMALILAND"` matching variant `"BERBERA"`.
3. **Fuzzy pass** (only if allow-list missed): Levenshtein distance between the normalized input and each canonical port name (`"BERBERA"`, `"ZEILA"`). If min distance ≤ 2 across all canonical names, return `PROPOSE(port=closest, score=distance)`. Otherwise `NONE`.
4. **Multi-port edge case** (`"BBR > DJB"`): if normalized contains substrings of multiple canonical/variant tokens (one for our port + one for a competitor like Djibouti), still emit `PROPOSE` with note flag `multi_port=true` so the admin can decide. Implementation can defer to v0+1; v0 just emits `MATCH` if any variant hits.

### ETA decoding (open question §10.1)

AIS-5 encodes ETA as `MMDDHHMM` (no year). Heuristic: the decoded `time.Time` uses current UTC year; if `decodedETA < now`, add 1 year. Validate this with table-driven tests (Dec→Jan rollover, Feb-29 in non-leap years).

### Cache (`originport/cache.go`)

In-memory LRU keyed by MMSI. Stores `{IMO, Destination, lastSeenAt}`. TTL 24h, exported as `const CacheTTL = 24 * time.Hour` so it can be tuned without a code search. Used to:
- Avoid INSERT spam when the same vessel rebroadcasts ShipStaticData every ~6 min.
- Correlate static data with corridor.Watcher hits (future use; v0 doesn't need this but the cache exists).

Race-safe via `sync.RWMutex`; tested with `-race`.

---

## 7. Admin UI

### 7.1 New page `/admin/origin-port-proposals`

Calqued on [`/admin/escalations`](../../../frontend/src/app/(dashboard)/admin/escalations/page.tsx). Uses `OsTable`, `OsBadge` primitives ([`Os*.tsx`](../../../frontend/src/components/ui/)).

**Columns**: MMSI · Vessel name · Raw destination · Normalized · Guess · Fuzzy score · Created at · Actions.

**Approve modal**:
- Confirms target port (BERBERA / ZEILA dropdown if guess confidence is low).
- Toggle "Add `<normalized>` to allow-list" (default ON, idempotent).
- Toggle "Create a backdated UNCLAIMED arrival_alert" (default ON if vessel still at sea, OFF if past EEZ entry).
- Server action `approveDestinationProposal({proposalId, port, addToAllowList, createAlert, note})`.

**Reject modal**: free-text note → `UPDATE status='REJECTED'`, audit_log entry.

### 7.2 Extension to `/admin/tax-settings`

New panel **"Origin-port detection (Phase 2)"**:
- Toggle `feature.ais_global_enabled` (SUPERADMIN-only, same gate as other feature flags).
- Editor for `arrival.origin_port_allow_list`: per-port table of variants with add/remove actions.
- Counter: `N proposals PENDING` linking to `/admin/origin-port-proposals`.

### 7.3 RBAC

Sidebar entry `/admin/origin-port-proposals` gated `SUPERADMIN | PORT_OFFICER | FINANCE_ADMIN` (same set as `/admin/escalations`). Server action mutations restricted to `SUPERADMIN | PORT_OFFICER`. Updates to [`DashboardSidebar.tsx`](../../../frontend/src/components/dashboard/DashboardSidebar.tsx) and [`rbac.ts`](../../../frontend/src/lib/rbac.ts).

### 7.4 i18n

New namespace `AdminOriginPort` (PascalCase, project convention). EN + FR shipped. AR/PT/SW = EN fallback (P2 debt, tracked in ROADMAP).

---

## 8. Configuration & Feature Flags

No new env vars. All toggles live in `app_config`:

| Key | Default | Purpose |
|---|---|---|
| `feature.ais_global_enabled` | `false` (existing) | Master toggle for the whole module |
| `arrival.origin_port_allow_list` | seed JSON in mig 044 | Variant matcher source |

Go backend reads both via the existing `appconfig.Reader` (cached, refreshed every 60s). Flag flip closes/opens WS1 without process restart.

---

## 9. Testing Strategy

| Layer | Coverage |
|---|---|
| Go unit — `originport/matcher_test.go` | Table-driven, ≥30 Destination variants. Includes `BBR > DJB` (PROPOSE multi-port), `DJIBOUTI` (NONE), `BERBARA` (PROPOSE Lev=1), `BERBERA SOMALILAND` (MATCH substring), empty / whitespace / Unicode (NONE). |
| Go unit — `originport/cache_test.go` | LRU eviction at TTL 24h, concurrent writes under `-race`. |
| Go unit — `originport/watcher_test.go` | With `sqlmock`: MATCH → INSERT alert; PROPOSE → INSERT proposal; duplicate → silent no-op via unique violation; flag OFF → total no-op. |
| SQL migration tests — `supabase/tests/migrations/043_*.test.sql`, `044_*.test.sql`, `045_*.test.sql`, `046_*.test.sql` | RLS read/write per role; `detection_source` default + backfill; unique index on PENDING proposals; idempotent allow-list seed. |
| Frontend Vitest — server actions | `approveDestinationProposal` allow-list merge idempotent (re-approving an existing variant doesn't duplicate); `rejectDestinationProposal`; concurrent approve race. |
| Frontend Vitest — page rendering | `/admin/origin-port-proposals`: SUPERADMIN sees Approve/Reject; FINANCE_ADMIN read-only; SHIPPING_AGENT redirected. |
| Manual integration (post-merge) | With flag true + synthetic ShipStaticData injection: verify alert lands in `/admin/escalations` UNCLAIMED panel. |

No Playwright E2E (consistent with Plan 7 which also defers to manual integration for the AIS-dependent path).

---

## 10. Open Questions (resolved during plan-writing, non-blocking)

### 10.1 AIS-5 ETA year disambiguation
**Resolved.** Heuristic: decode with current UTC year; if `decodedETA < now`, add 1 year. Tests must cover Dec→Jan rollover and Feb-29 in non-leap years.

### 10.2 Cache TTL tuning
**Resolved.** Start at `const CacheTTL = 24 * time.Hour`. Measure hit ratio via Go expvar / log sampling in staging; adjust the constant if hit ratio < 70%.

### 10.3 Vessel changes Destination en route
**Resolved.** No automatic action. The alert stays UNCLAIMED in `/admin/escalations`; PORT_OFFICER may manually `CANCELLED` it. Auto-cancel on Destination change risks too many false negatives (crew typos, multi-port voyages).

### 10.4 WS1 bbox monde acceptance
**Resolved.** Implement as **4 quadrant subscriptions** (`[-90,-180]–[0,0]`, `[-90,0]–[0,180]`, `[0,-180]–[90,0]`, `[0,0]–[90,180]`) rather than a single global bbox. Avoids any aisstream.io edge-case behavior on `[-90,-180]–[90,180]`.

---

## 11. Rollout

1. Merge to `develop` with `feature.ais_global_enabled=false`. Zero production impact.
2. Staging: flip to `true`, observe Go logs for 1h. Target: ≤50 proposals/day during the learning phase. Verify `/admin/origin-port-proposals` populates.
3. Allow-list curation: an admin reviews the first ~50 proposals, enriches the allow-list. Proposal rate should drop to <10/day.
4. Production enablement: only after the MATCH-vs-PROPOSE ratio exceeds 90% over 48h in staging.

Rollback: flip flag to `false`. WS1 closes, no further originport alerts created. Existing alerts remain in their current state (UNCLAIMED or claimed downstream); no auto-cleanup.

---

## 12. Migrations to Create

| Mig | Purpose |
|---|---|
| `043_arrival_alerts_detection_source.sql` | New enum + nullable corridor-specific columns + index for ORIGINPORT UNCLAIMED |
| `044_destination_match_proposals.sql` | New table + RLS + unique pending index |
| `045_origin_port_allow_list_config.sql` | Seed `arrival.origin_port_allow_list` in `app_config` |
| `046_agent_match_skip_originport.sql` | Replace `agent-match` cron function so it skips `detection_source='ORIGINPORT'` |

---

## 13. Branch & Commit Convention

- **Branch**: `feat/ais-global-v0` from `develop`.
- **Commits**: `feat(originport): Plan 8 Task N — <description>` (consistent with Plans 6 and 7).
- **PR title**: `Plan 8 — AIS global origin-port detection (v0)`.

---

## 14. Cross-References

- Master spec §3 decision #2, §6.1 detection flow, §8 feature flags, §9 Phase 2: [`2026-04-22-proactive-vessel-detection-and-proforma-design.md`](2026-04-22-proactive-vessel-detection-and-proforma-design.md)
- Existing corridor module (do not modify): [`backend/internal/corridor/watcher.go`](../../../backend/internal/corridor/watcher.go)
- Existing AIS ingester (will be modified): [`backend/internal/ais/ingester.go`](../../../backend/internal/ais/ingester.go)
- Existing feature flag (set by mig 027): [`supabase/migrations/027_app_config_carbon_tax_keys.sql`](../../../supabase/migrations/027_app_config_carbon_tax_keys.sql)
- Existing app_config reader: [`backend/internal/appconfig/`](../../../backend/internal/appconfig/)
- Plan 7 proposal-review pattern (UI template to mimic): [`frontend/src/app/(dashboard)/admin/equasis-proposals/`](../../../frontend/src/app/(dashboard)/admin/equasis-proposals/)
