# Legacy migration tests

These tested tables that were renamed/dropped in later migrations.
Kept for historical reference; not run in CI.

- `039_shipowner_portal.test.sql` — superseded by `048_payments_polymorphic.test.sql`
  (table `shipowner_payment_intents` was renamed to `payments` in mig 048).
