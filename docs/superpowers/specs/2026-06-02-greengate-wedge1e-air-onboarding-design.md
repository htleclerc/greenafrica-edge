# GreenGate v8 — Wedge 1 · W1‑E: Air operator self‑service onboarding — Design

> **Status:** design (approved by PO 2026‑06‑02). The deferred self‑service piece of Wedge 1. Builds on W1‑A (`aircraft`), W1‑C (ADS‑B GHOST air operator). **Branch:** `feat/greengate-wedge1e-air-onboarding` (stacked on `feat/greengate-wedge1d-aviation-ui` — needs migs 074→078; mig 079 follows 078).
> **Parent:** GREENGATE_V8_MULTITENANT.md §5 step 1, §8 (unified operator onboarding). Closes the W1‑D deferral "deep air‑operator self‑service onboarding form + claim UX".

## 1. Goal
Let an **air operator sign up and log in by themselves** through the unified owner portal — the air mirror of the maritime shipowner self‑service flow. Today an aviator can only be onboarded admin‑side (`inviteShipowner`); the only self‑service form (`/owner/register`) is maritime (asks a 7‑digit **vessel IMO**, matches `vessels`). This wedge adds an **air mode** to that flow that claims a GHOST operator by an **aircraft identifier + AOC number**.

## 2. Decisions (locked during brainstorming)
- **Claim key = aircraft registration OR icao24.** One form field; the action matches `aircraft.registration` if it equals the value, else `aircraft.icao24` (icao24 is UNIQUE per mig 076; registration may be NULL on a GHOST if the ADS‑B feed didn't enrich it).
- **Identity proof = AOC number** (Air Operator Certificate) — the air equivalent of maritime `imo_company_no`. **Auto‑claim only when the submitted AOC matches the value pre‑seeded on the GHOST operator.** Registrations/icao24 are public, so an aircraft match alone is NOT sufficient (anti‑takeover) — the AOC is the secret.
- **AOC source = admin pre‑seed.** An admin loads the expected AOC (from the Somaliland CAA) onto the GHOST operator **before** the aviator signs up, so the first claim auto‑succeeds. Mirror of how maritime GHOST shipowners get `imo_company_no` (Equasis) and of the curated‑reference pattern (EDB).
- **Entry point = one page + mode selector.** `/owner/register` shows a Maritime / Air toggle; the air branch posts to a **separate, isolated `registerAirOperator` action** (no `mode` branch tangled into `registerShipowner`).
- **Approach A** (validated): `aoc_number` is a column on `shipowners` (not a separate registry table). One operator = one AOC for v1.
- **Admin approval reused as‑is:** `approveShipownerRegistration` is already mode‑agnostic (flips state, invites, profile+wallet+audit; touches no vessel/IMO field) → air PENDING_REVIEW rows approve through it unchanged.

## 3. Schema — mig 079 (+ `.test.sql`)
```sql
-- Air operator identity (mirror of imo_company_no). Nullable; only air operators carry it.
ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS aoc_number TEXT;
COMMENT ON COLUMN public.shipowners.aoc_number IS
  'GreenGate v8 W1-E: Air Operator Certificate number. Air-mode identity proof; admin pre-seeds the expected value on the GHOST operator so self-service auto-claim can match it. Air equivalent of imo_company_no.';

-- Extend the proof_doc_type CHECK (mig 047) to accept the AOC certificate.
-- mig 047 added the column inline, so PostgreSQL auto-named the constraint
-- shipowners_proof_doc_type_check (verify with \d shipowners during implementation).
ALTER TABLE public.shipowners DROP CONSTRAINT IF EXISTS shipowners_proof_doc_type_check;
ALTER TABLE public.shipowners ADD CONSTRAINT shipowners_proof_doc_type_check
  CHECK (proof_doc_type IN ('TRADE_REGISTER','CERT_INCORPORATION','MOA','OTHER','AOC'));
```
- No index on `aoc_number` (it's compared in app code after the operator is loaded by aircraft→operator_id, never queried directly).
- **pg test 079**: `aoc_number` exists + nullable; `proof_doc_type` CHECK accepts `'AOC'` and rejects a bogus value; maritime values still accepted (non‑regression).

## 4. Components / files
- **`supabase/migrations/079_greengate_air_operator_aoc.sql`** (+ test).
- **`frontend/src/actions/registerAirOperator.ts`** — `'use server'`, isolated mirror of `registerShipowner.ts`. Zod schema (email, name, country_code, address, **aoc_number**, **aircraft_ident** (registration|icao24), proof_doc_storage_path, proof_doc_type=`'AOC'`, phone?, preferred_language, recaptcha_token). Same anti‑enumeration `GENERIC_MESSAGE`, rate limit (`signup-air-operator`), reCAPTCHA, `createPlatformClient`.
- **`frontend/src/app/api/auth/register-air-operator/route.ts`** — POST wrapper (mirror `register-shipowner`).
- **`frontend/src/app/owner/register/`** — add the Maritime/Air selector. Keep the existing `RegisterForm` (maritime) untouched; extract an **`AirRegisterForm.tsx`** with the air fields. The page renders the toggle + the selected form. The page gate reads BOTH flags and shows whichever mode(s) are enabled.
- **`frontend/src/actions/setOperatorAocNumber.ts`** — admin action (SUPERADMIN/MANAGER), jurisdiction‑scoped (`assertAdminCanActOn`/`getServerJurisdictionId` pattern + `createTenantClient`), sets `shipowners.aoc_number` on a GHOST/any operator. The pre‑seed mechanism.
- **Admin UI (minimal, YAGNI):** add ONE inline AOC text input + save button to each operator row in the existing admin operators list (candidate component: `/admin/owner-agent-mappings` ShipownersList — confirm at implementation), wired to `setOperatorAocNumber`. Do **not** build a new admin page. For review: verify `/admin/registrations` already shows `proof_doc_url`; if the declared `aoc_number` isn't visible on the row, add it read‑only so the reviewer can check the AOC certificate against it.
- **`frontend/src/lib/feature-flags.ts`** — add `airSelfServiceEnabled` reading `feature.air_self_service_enabled` (defaults false, strict `=== true`). Add the key to `app_config` allow‑list/order (updateAppConfig.ts) so admins can toggle it.
- **Reused unchanged:** `approveShipownerRegistration`, `/owner/login`, `/owner/auth/callback`, `shipowner-kyc` storage bucket.

## 5. Data flow (`registerAirOperator`, branch‑for‑branch mirror of `registerShipowner`)
1. Air form → POST `/api/auth/register-air-operator` → `registerAirOperator(input, clientIp)`.
2. **Flag gate** `airSelfServiceEnabled` (defense‑in‑depth: refuse the write even on a direct POST) → **rate limit** → **zod** → **reCAPTCHA**.
3. `createPlatformClient` (anonymous signup, no tenant context; new rows inherit Somaliland via column DEFAULT while single‑country).
4. **Match aircraft**: let `V = aircraft_ident.trim()`. Query `.from('aircraft').select('id, operator_id').or(\`registration.eq.${V},icao24.eq.${V.toLowerCase()}\`)` — registration matched as entered (stored uppercase tail), icao24 matched lowercased (stored lowercase hex). Use `.limit(2)`: exactly one row → proceed; zero or ≥2 (ambiguous) → treat as not‑found → PENDING_REVIEW.
5. **Aircraft found + operator_id present** → load operator (`shipowners`: id, account_state, aoc_number):
   - `account_state='GHOST'` **AND** `normalize(aoc_number) === normalize(submitted AOC)` → **`autoClaimAir`**: race‑safe `UPDATE … SET account_state='ACTIVE', name, address, country_code, phone_e164, preferred_language, proof_doc_url, proof_doc_type, kyc_level_b_completed_at WHERE id=… AND account_state='GHOST'`; then `inviteUserByEmail` (redirect `/owner/auth/callback`), upsert `profiles` (role `SHIPOWNER`), set `profile_id`, insert `wallets`, audit `details_json.event='AIR_OPERATOR_AUTO_CLAIM'`. Invite failure → rollback to GHOST.
   - `GHOST` but **AOC mismatch** → `insertPendingReviewAir`.
   - non‑GHOST (ACTIVE/INVITED/SUSPENDED/REJECTED) → no write (anti‑takeover), generic message.
6. **No aircraft match** (cold signup) → `insertPendingReviewAir` (admin links the operator + approves later).
7. **All non‑auto‑claim paths return the same `GENERIC_MESSAGE`** (anti‑enumeration). `autoClaimAir` returns it too (+ internal `autoClaimedId`).

`insertPendingReviewAir` inserts a `shipowners` row: name, **aoc_number** (declared), country_code, address, official_email + `official_email_source='AGENT_CLAIM'`, phone, preferred_language, proof_doc_url/type=`'AOC'`, `kyc_level_b_completed_at=now()`, `account_state='PENDING_REVIEW'`, `applicable_modes=['AIR']`. (No audit_log — anonymous user violates audit_logs.user_id NOT NULL, same as maritime.)

## 6. Error handling / security
- **Fail‑secure flag**, **anti‑enumeration** generic message, **race‑safe** claim (`.eq('account_state','GHOST')`), **rollback** to GHOST on invite failure, **normalized exact** AOC compare (trim + uppercase both sides).
- Public registration/icao24 → **no auto‑claim without an AOC match** (the whole point of the AOC secret).
- Upload handled client‑side to `shipowner-kyc` before the POST (mirror maritime); the action only receives `proof_doc_storage_path`.

## 7. Tests
- **Vitest `registerAirOperator`**: (a) auto‑claim on AOC match → ACTIVE + invite + wallet + audit; (b) AOC mismatch on GHOST → PENDING_REVIEW; (c) aircraft not found → PENDING_REVIEW; (d) non‑GHOST operator → no write; (e) flag OFF → refuse; (f) rate‑limit; (g) reCAPTCHA fail → generic. Mocks target `@/lib/supabase/tenant` + feature‑flags + rate‑limit.
- **Vitest `setOperatorAocNumber`**: role gate, jurisdiction isolation, happy path sets `aoc_number`.
- **Vitest form**: mode selector renders both; air form posts the air fields.
- **pg test 079** (see §3).
- **Gates**: `supabase db reset` 001→079 clean; `tsc`; `eslint`; full `vitest` green.

## 8. NOT in W1‑E (deferred / YAGNI)
Multiple AOCs per operator · automated AOC verification against an external CAA registry (admin‑curated only) · claiming an individual aircraft rather than the operator · a dedicated air KYC‑C wizard (the form + AOC certificate is the v1 KYC) · multi‑country signup (subdomain→jurisdiction, Wedge 2) · agent/intermediary air‑claim UX.
