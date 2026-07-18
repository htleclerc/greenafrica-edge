-- ─────────────────────────────────────────────────────────────────────────────
-- Green-Gate — Migration 005 (retired, content moved to supabase/seed.sql)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- This migration previously seeded demo vessels, transactions, tax configs,
-- exemptions, audit logs, and carbon projects. It was ordered before
-- supabase/seed.sql (which provisions the demo auth users + profiles), so the
-- FK references it contained (owner_id, created_by, approved_by, user_id →
-- profiles) could never satisfy, and `supabase db reset` failed consistently.
--
-- The content now lives in supabase/seed.sql, where profiles already exist.
-- This file is kept as a no-op placeholder so migration history ordering
-- stays stable for existing local databases.
--
-- See commit history for the original data (pre-move).

SELECT 1;  -- no-op, keeps the migration valid and idempotent
