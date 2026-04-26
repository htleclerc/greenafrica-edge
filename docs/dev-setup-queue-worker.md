# Queue worker — cross-platform dev setup

Migrations [`035_proforma_worker_cron.sql`](../supabase/migrations/035_proforma_worker_cron.sql)
and [`036_reconciliation_trigger_and_cron.sql`](../supabase/migrations/036_reconciliation_trigger_and_cron.sql)
seed `app_config.queue.worker_url` to `http://host.docker.internal:3300` so
the pg_cron jobs running inside the Supabase Postgres container can call
back into the Next.js dev server on the host.

`host.docker.internal` is auto-resolved on **Docker Desktop** (macOS, Windows).
On **Linux** with native Docker (Docker Engine, no Desktop) it does **not**
resolve by default — your cron job will fail silently with a DNS error.

## Quick check

After `supabase start`, run:

```sql
SELECT cron.run_command_local('proforma-worker') ;  -- one-shot trigger
SELECT * FROM cron.job_run_details
 WHERE jobname = 'proforma-worker'
 ORDER BY start_time DESC LIMIT 1;
```

If `return_message` contains `Could not resolve host` or `Connection refused`,
you're hitting the Linux gotcha.

## Fix options (Linux native Docker)

Pick one — the first is the least invasive:

### Option A — point the URL at the Docker bridge gateway

The default Docker bridge IP for the host is `172.17.0.1` (verify with
`ip addr show docker0`). Update `app_config` to use it directly:

```sql
UPDATE public.app_config
   SET value = '"http://172.17.0.1:3300"'::jsonb
 WHERE key = 'queue.worker_url';
```

This is per-machine state — don't commit a new migration for it.

### Option B — add a `host.docker.internal` entry to /etc/hosts in the container

Find the postgres container ID:
```bash
docker ps --filter name=supabase_db --format '{{.ID}}'
```

Then:
```bash
docker exec -u root <container-id> sh -c \
  "echo '172.17.0.1 host.docker.internal' >> /etc/hosts"
```

This survives until the container is recreated (e.g. `supabase stop`).

### Option C — run the Next.js dev server inside the same Docker network

If you `docker compose` your dev setup, attach the Next.js container to
the `supabase_default` network and use the container hostname instead of
`host.docker.internal` in `app_config.queue.worker_url`. Most teams find
this overkill for solo dev.

## Production (hosted Supabase + Fly.io)

`app_config.queue.worker_url` should be set to the public Next.js URL
once per environment, e.g.:

```sql
UPDATE public.app_config
   SET value = '"https://your-frontend.example.com"'::jsonb
 WHERE key = 'queue.worker_url';
```

Hosted Supabase Postgres reaches the public internet directly — no
`host.docker.internal` involved.

## Why no migration fix?

Migrations 035 and 036 are already applied to the hosted DB. Editing
them in-place would create drift. The `app_config.queue.worker_url`
default is intentionally a per-environment value — operators are
expected to overwrite it after `supabase db push`. The convention is
documented in `docs/superpowers/ROADMAP.md` and this file.
