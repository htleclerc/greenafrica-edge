# Legal review checklist — Equasis scraping

> **Status**: Plan 7 v0 ships the scraper scaffold with the HTTP fetcher
> deliberately disabled. The real fetch path is gated behind
> `feature.equasis_scraper_enabled` AND the `EQUASIS_FETCHER=http` env
> var; switching either off keeps the worker harmless. This doc lists the
> questions that must be resolved before turning both on.

## Equasis terms of service

Equasis is operated by the European Maritime Safety Agency (EMSA) /
French Ministry. The public access portal at https://www.equasis.org/
requires registration. Its conditions of use prohibit:

- Automated scraping or systematic data harvesting
- Bulk data extraction
- Re-distribution of the data without permission

Source: https://www.equasis.org/EquasisWeb/restricted/Login (terms
visible to logged-in users).

## Questions to address before enabling

1. **Authorisation path**
   - Has Green Gate / the Government of Somaliland reached an explicit
     data-sharing agreement with EMSA?
   - If yes: under what scope? (Read-only owner-email lookup is the
     minimal use; the worker must respect the granted scope.)
   - If no: pursue a partnership request before any HTTP fetch is
     enabled.

2. **Authentication**
   - Will the worker use a single shared Equasis account, or per-officer
     credentials?
   - How are credentials stored? (Supabase secrets / env vars must NOT
     contain plaintext passwords; a token-rotation scheme is preferable.)
   - What happens when the account is locked / rate-limited?

3. **Rate limit + politeness**
   - Equasis publishes no formal rate limit, but field reports suggest
     blocking after 30+ requests/min from one IP.
   - The scraper has a 5-second per-domain delay scaffold. Confirm with
     legal/EMSA the acceptable rate.

4. **Data minimisation**
   - The scraper should request ONLY the fields it needs (owner name,
     manager, email, country). It should NOT mass-download vessel
     specs / inspection histories / detentions.
   - Audit log every Equasis fetch (which IMO, when, by which worker
     instance).

5. **Storage + retention**
   - `equasis_scrape_proposals` retains the scraped data indefinitely
     today. If the partnership requires X-day retention or an opt-out
     for owners, add a TTL job to mig.

6. **Owner notification**
   - GDPR / data-protection considerations: when owner email is
     extracted, does the owner have a right to know? The current Plan 6
     invitation flow notifies them; that may be enough, or it may need
     a pre-extraction notice.

7. **Attribution**
   - If proposals are applied to `shipowners` rows, the audit log
     captures `source='scraper'`. Should that be exposed to the owner
     when they view their account info on `/owner/dashboard`?

## Activation procedure (after sign-off)

1. Resolve all 7 questions above with legal team. Document answers
   alongside this file.
2. Implement the actual HTTP fetcher: replace `httpFetcher.Fetch` in
   `backend/cmd/scraper/main.go` with session-aware HTTP client.
3. Add credential storage to Supabase secrets (NOT env vars in plain
   text).
4. Deploy worker to a separate Fly.io machine — the api machine should
   not run the scraper (different scaling characteristics, different
   blast radius).
5. Run on a non-production Supabase environment for at least one week
   to verify rate-limit compliance + blocking patterns.
6. Flip `feature.equasis_scraper_enabled=true` in production
   `app_config`.
7. Announce the activation internally + add to compliance log.

## What ships in v0 right now

- Manual entry at `/admin/equasis-proposals` is fully operational and
  bypasses Equasis entirely.
- Worker scaffold runs with `EQUASIS_FETCHER=fixture` against
  fixture HTML files for dev/CI.
- Real HTTP fetcher is a stub (`httpFetcher.Fetch` returns an error
  with explicit message).
- Feature flag stays `false` in production.

This means the team can collect owner emails today through the manual
flow while the legal questions get answered. No accidental scrape can
happen — the wiring is OFF in three independent places (flag + env var
+ stub error).
