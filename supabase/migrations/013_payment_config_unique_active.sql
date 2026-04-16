-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 013: Enforce single-active-provider invariant on payment_config
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Migration 011 declared "only ONE provider can be active at a time" but did
-- not enforce it. This allowed two rows with is_active=true to coexist if the
-- application logic in setActiveProvider() failed mid-transaction.
--
-- A partial unique index is the cleanest way to express this in PostgreSQL:
-- only rows where is_active=true are indexed, and the index has zero columns
-- so any second row triggers a uniqueness violation.

-- Defensive: if multiple rows are already is_active=true (from prior bugs),
-- keep only the most recently updated one and clear the others first.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY updated_at DESC NULLS LAST, id) AS rn
    FROM public.payment_config
    WHERE is_active = true
)
UPDATE public.payment_config
SET is_active = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Now enforce the single-active rule going forward
CREATE UNIQUE INDEX IF NOT EXISTS payment_config_single_active
    ON public.payment_config ((true))
    WHERE is_active = true;

COMMENT ON INDEX public.payment_config_single_active IS
    'Partial unique index enforcing only one provider can be is_active=true at a time. Inserting a second active row will fail.';
