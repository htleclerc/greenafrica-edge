# Tax calculator test harness

Integration tests in `internal/tax/` and `internal/tariff/` require a real
PostgreSQL instance (port 55444 by default).

## Setup

```bash
# 1. Start a throwaway Postgres instance (initdb 18.3, no socket)
initdb -D /tmp/pgtest && pg_ctl -D /tmp/pgtest -o "-p 55444" -l /tmp/pgtest/pg.log start

# 2. Create the database
psql -p 55444 -c "CREATE DATABASE postgres;"

# 3. Apply the harness stub (stubs Supabase extensions / auth / helper functions)
psql -p 55444 -d postgres -f backend/testdata/harness_stub.sql

# 4. Apply real migrations (order matters — FKs enforced)
psql -p 55444 -d postgres -f supabase/migrations/025_emission_factors_and_seeds.sql
psql -p 55444 -d postgres -f supabase/migrations/071_greengate_foundation_tenancy.sql
psql -p 55444 -d postgres -f supabase/migrations/074_greengate_aircraft_aviation.sql
psql -p 55444 -d postgres -f supabase/migrations/075_greengate_air_pricing_methodology.sql
psql -p 55444 -d postgres -f supabase/migrations/080_greengate_tariffs_versioned.sql

# 5. Run Go tests (serial — tests share a single DB instance)
SUPABASE_DB_URL=postgresql://postgres@127.0.0.1:55444/postgres \
  go test ./internal/tax/ ./internal/tariff/ -p 1 -v

# 6. Run the mig 080 pgTAP test
psql -p 55444 -d postgres -f supabase/tests/migrations/080_greengate_tariffs_versioned.test.sql

# 7. Stop and clean up
pg_ctl -D /tmp/pgtest stop && rm -rf /tmp/pgtest
```

> The `SUPABASE_DB_URL` env var is read by all test helpers; the default
> fallback is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
> (Supabase CLI local stack).
