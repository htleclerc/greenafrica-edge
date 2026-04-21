# TODOS

Deferred work captured during plan reviews. Each entry has enough context that a
dev can pick it up cold in 3 months.

---

## 1. Restrict simulator auto-completion to armateur's own vessels

**What:** Add guard in `/api/simulator/estimate` (or UI autocomplete) so a SHIPPING_AGENT
can only simulate on vessels they own (by IMO). Today the simulator is unrestricted —
any authenticated user can pick any IMO.

**Why:** Armateur A knowing armateur B's IMO can simulate B's tax exposure. Not a
security breach (tax rate + decree are public), but arguably a competitive
information leak. Product-level decision whether this matters.

**Pros:**
- Closes a soft information-leak vector
- Enforces "armateur only sees own vessels" everywhere consistently

**Cons:**
- Simulator is supposed to be educational/public-facing
- Adds friction (armateur can't pre-simulate a potential fleet acquisition)
- Decree rate is public info anyway — the "leak" is only the tonnage estimation

**Context:** Surfaced during /plan-eng-review 2026-04-21 (armateur hardening PR).
Armateur role changes were scoped to UI + API generate route but the simulator was
left open as a deliberate product decision. Revisit if user feedback shows
armateurs using it to scout competitor exposure.

**Depends on / blocked by:** Product decision — talk to Loic before implementing.

---

## 2. Wire Playwright into GitHub Actions CI

**What:** Add `.github/workflows/e2e.yml` that runs the Playwright tests on every PR.
Requires: seeded test database (Supabase local or CI fixtures), Vercel preview URL
or local dev server boot, secret management for test auth tokens.

**Why:** Playwright is being added in the armateur-hardening PR, but tests will only
run locally on dev machines until CI is wired. The critical security boundary tests
(armateur curl → 403 on /api/invoices/generate, armateur cannot see other armateurs'
tx) will silently regress if any future PR breaks them.

**Pros:**
- Auto-blocks security regressions at PR time
- Gives confidence for future refactors touching RBAC
- Reusable for PR-2 NET-30, PR-3 wallet, etc.

**Cons:**
- ~30-60 min setup (Supabase test fixtures are the hard part)
- CI minutes cost — E2E suite will run on every PR
- Flake risk if not properly isolated (each test needs fresh user sessions)

**Context:** /plan-eng-review 2026-04-21 recommended setting up Playwright in the
armateur PR (accepted) but flagged CI wiring as separate work. Without this, the
E2E safety net only catches regressions for the dev running them locally.

**Depends on / blocked by:** Supabase test fixtures / seed scripts. Consider
using `supabase local` or a dedicated staging database.

---

## 3. Native-speaker review of SO + AR strings for armateur portal

**What:** The armateur-hardening PR adds ~14 i18n keys × 4 languages (56 entries).
Translations for `so` (Somali) and `ar` (Arabic) will be produced by one dev/LLM.
Schedule a review round with native speakers familiar with Somaliland institutional
register before V1 public launch.

**Why:** Solide is a B2G platform. Tone must match decree/institutional register
— a colloquial phrasing would damage credibility with MoECC and armateur legal
departments. Arabic also has formal/informal register distinction, and RTL
rendering requires careful review (Plex Arabic font is wired, but per-string
direction attributes may need audit).

**Pros:**
- Protects brand credibility with government counterparty
- Catches RTL-rendering edge cases (mixed LTR numbers, dates)
- Avoids post-launch translation churn

**Cons:**
- Requires finding + paying native reviewers (Somali speaker with B2G/maritime
  vocabulary; Arabic speaker with institutional/formal register)
- Adds ~1 week to V1 launch if done as blocking gate
- Marginal value if initial armateur beta is all francophone/anglophone

**Context:** Surfaced during /plan-design-review 2026-04-21 (armateur hardening PR).
Design review flagged tone as part of anti-slop posture. Applies to all 14 keys
added in this PR: ArmateurDashboard.* + VesselDetail.*.

**Depends on / blocked by:** Identify native reviewer sources. Consider using
Solide's Somaliland partners or Université Djibouti maritime law program.

---

## 4. Run /design-review (live visual QA) after armateur-hardening implementation

**What:** After the PR is implemented and deployed to a preview URL, run the
/design-review skill on: `/dashboard` (armateur mode), `/dashboard/my-fleet`
(slide-over with Paiements tab), `/dashboard/invoices` (armateur mode with Export),
`/dashboard/simulator`. The /plan-design-review produced a spec; /design-review
verifies the spec was implemented faithfully.

**Why:** Plan reviews catch missing design decisions. They cannot catch
implementation drift (spec said 64px chiffre days-remaining, engineer shipped
48px; spec said fade 150ms, engineer shipped 300ms spring). Live visual QA
closes the loop.

**Pros:**
- Catches implementation-vs-spec drift before shipping to real armateurs
- Provides screenshots for the PR review
- Catches rendering bugs specific to preview env (font loading, RTL Arabic
  cases, Safari/Firefox quirks)

**Cons:**
- Requires preview URL + test data seeded (mock armateur with overdue, mock
  with empty state, mock with onboarding 0-vessel)
- ~30min CC to run + iterate
- Slightly redundant if implementation is done with design-first discipline

**Context:** /plan-design-review 2026-04-21 (armateur hardening PR) locked in 14
design decisions across 7 passes. Spec is detailed but rendered result may drift.

**Depends on / blocked by:** PR deployed to Vercel preview; test data fixtures
for the 4 states (happy path, overdue, empty, onboarding 0-vessel).
