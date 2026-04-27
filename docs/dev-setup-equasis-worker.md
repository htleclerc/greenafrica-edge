# Equasis scraper worker — local dev setup

The Plan 7 scraper (`backend/cmd/scraper`) ships in fixture mode by
default. Real Equasis access requires legal sign-off (see
[`docs/legal-equasis-scraping.md`](legal-equasis-scraping.md)) and is
deliberately gated behind a stub HTTP fetcher.

## Run locally

```bash
cd backend
go run ./cmd/scraper
```

Required env (loads from `backend/.env` if present):

- `SUPABASE_DB_URL` — Postgres connection string. Defaults to local
  supabase (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

Optional env:

- `EQUASIS_FETCHER` — `fixture` (default) or `http` (stub, errors out)
- `EQUASIS_FIXTURES_DIR` — override the directory holding `<imo>.html`
  files. Default: `testdata/equasis` relative to the worker's cwd.

The worker exposes a health endpoint on `:8081/health`.

## Feature flag

The worker no-ops while `feature.equasis_scraper_enabled` is `false` in
`app_config`. Default is `false`. To enable for a local test run:

```sql
UPDATE public.app_config
   SET value = 'true'::jsonb
 WHERE key = 'feature.equasis_scraper_enabled';
```

Remember to set it back to `false` when done.

## Test the full loop locally

1. Pick an IMO that has an arrival_alert in `UNCLAIMED` status and a
   vessel without an owner email. Record its IMO (e.g. `9876543`).
2. Create the matching fixture: `backend/testdata/equasis/9876543.html`.
   Use one of the existing files (e.g. `happy.html`) as a template; the
   parser extracts `<td>Label</td><td>Value</td>` rows.
3. Manually trigger the enqueue function instead of waiting 30 min:
   ```sql
   SELECT public.equasis_enqueue_pending();
   ```
4. Run the worker (`go run ./cmd/scraper`). It should pop the message,
   read your fixture, parse it, and insert a row into
   `equasis_scrape_proposals` with `source='fixture'`.
5. Open `/admin/equasis-proposals` in the dashboard. The proposal
   should appear in the "Pending review" section.

## Adding new fixtures

Each fixture is a filename = IMO number, with `.html` extension. The
existing fixtures cover four cases:

- `happy.html` (IMO 9876543) — full data, parser extracts everything
- `no_email.html` (IMO 9123456) — email visible only after login;
  parser leaves `Email` empty
- `captcha.html` — page is gated; parser returns `ErrCaptcha`
- `not_found.html` — Equasis reports no record; parser returns
  `ErrIMONotFound`

To trigger the worker for a specific IMO via fixture, just create the
file and enqueue.

## Switching to real Equasis (later)

When you have the green light:

1. Replace `httpFetcher.Fetch` in `backend/cmd/scraper/main.go` with the
   real implementation: HTTP client, session cookie management, polite
   per-domain delay (≥ 5 sec between requests).
2. Set `EQUASIS_FETCHER=http` in the worker's environment.
3. Flip `feature.equasis_scraper_enabled = true` in production
   `app_config`.

The parser will likely need a rewrite — Equasis renders via JavaScript
and the regex selectors are tuned for the fixture format. Either use a
headless browser (chromedp) to render the JS first, or switch to the
actual XHR endpoints if Equasis exposes them.

## Why this is structured this way

The worker, parser, queue, cron, and admin review UI are all built and
tested. The only thing not built is the legally-risky part (real HTTP
fetch). That isolation is intentional: the team can collect owner
emails today via manual entry on `/admin/equasis-proposals` while the
automated path waits for the right legal framework.
