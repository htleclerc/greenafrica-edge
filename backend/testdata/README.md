# Tax calculator test harness

Integration tests in `internal/tax/`, `internal/tariff/`, `internal/geofence/`,
`internal/eez/`, `internal/corridor/`, and `internal/reconcile/` require a real
PostgreSQL instance (port 55451 by default).

## Setup

```bash
# 1. Start a throwaway Postgres instance (initdb 18.3, no socket)
initdb -D /tmp/pgtest && pg_ctl -D /tmp/pgtest -o "-p 55451" -l /tmp/pgtest/pg.log start

# 2. Create the database
psql -p 55451 -c "CREATE DATABASE postgres;"

# 3. Apply the harness stub (stubs Supabase extensions / auth / helper functions)
psql -p 55451 -d postgres -f backend/testdata/harness_stub.sql

# 4. Apply real migrations (order matters — FKs enforced)
psql -p 55451 -d postgres -f supabase/migrations/025_emission_factors_and_seeds.sql
psql -p 55451 -d postgres -f supabase/migrations/071_greengate_foundation_tenancy.sql
psql -p 55451 -d postgres -f supabase/migrations/074_greengate_aircraft_aviation.sql
psql -p 55451 -d postgres -f supabase/migrations/075_greengate_air_pricing_methodology.sql
psql -p 55451 -d postgres -f supabase/migrations/080_greengate_tariffs_versioned.sql
psql -p 55451 -d postgres -f supabase/migrations/081_greengate_revenue_split_rule.sql
psql -p 55451 -d postgres -f supabase/migrations/082_greengate_geofences_djibouti.sql
psql -p 55451 -d postgres -f supabase/migrations/083_greengate_vessel_zone_jurisdiction.sql

# 5. Run Go tests (serial — tests share a single DB instance)
SUPABASE_DB_URL=postgresql://postgres@127.0.0.1:55451/postgres \
  go test ./internal/geofence/ ./internal/eez/ ./internal/corridor/ ./internal/reconcile/ ./internal/tariff/ ./internal/tax/ -p 1 -v

# 6. Run migration pgTAP tests
psql -p 55451 -d postgres -f supabase/tests/migrations/080_greengate_tariffs_versioned.test.sql
psql -p 55451 -d postgres -f supabase/tests/migrations/083_greengate_vessel_zone_jurisdiction.test.sql

# 7. Stop and clean up
pg_ctl -D /tmp/pgtest stop && rm -rf /tmp/pgtest
```

> The `SUPABASE_DB_URL` env var is read by all test helpers; the default
> fallback is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
> (Supabase CLI local stack).
