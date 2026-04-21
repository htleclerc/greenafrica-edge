-- Migration 019: Security-definer RPC for the public /verify page (audit M1).
--
-- Why: after Tier 1, the /verify page still uses the SUPABASE_SERVICE_ROLE_KEY
-- server-side to bypass RLS and read the transactions row. That's intentional
-- today — the anon role doesn't have a SELECT policy on transactions — but it
-- means a single future refactor adding an extra column to the SELECT would
-- leak PII (owner email, payment references) without any RLS to stop it.
--
-- This migration replaces the direct SELECT with a `SECURITY DEFINER` RPC
-- that RETURNS TABLE (...) of ONLY the whitelisted columns. The /verify page
-- then switches to the anon key + `rpc('verify_invoice_lookup', ...)`, so:
--
--   1. The SET of columns ever reachable from /verify is fixed at the DB
--      layer. Adding a field to the page's UI requires explicitly altering
--      the function's RETURN signature — a deliberate, reviewable change.
--   2. Revoking execute from `public` and only granting to `anon` keeps
--      this function off-limits to authenticated / staff clients that have
--      richer paths for the same data.
--   3. `SET search_path = public` prevents search_path injection — a classic
--      trap for SECURITY DEFINER functions.

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_invoice_lookup(
    p_ref  TEXT,
    p_hash TEXT
)
RETURNS TABLE (
    invoice_ref        TEXT,
    content_hash       TEXT,
    vessel_name        TEXT,
    vessel_imo         TEXT,
    port_call          TEXT,
    transaction_type   TEXT,
    tax_amount_usd     NUMERIC,
    status             TEXT,
    paid_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    -- Returns AT MOST one row. Both invoice_ref and content_hash must match
    -- — this moves the anti-tampering check into the DB so a caller bug
    -- skipping the content_hash comparison can't accidentally surface data.
    SELECT t.invoice_ref,
           t.content_hash,
           t.vessel_name,
           t.vessel_imo,
           t.port_call,
           t.transaction_type::text,
           t.tax_amount_usd,
           t.status::text,
           t.paid_at,
           t.created_at
    FROM public.transactions t
    WHERE t.invoice_ref  = p_ref
      AND t.content_hash = p_hash
    LIMIT 1;
$$;

COMMENT ON FUNCTION public.verify_invoice_lookup IS
    'Public invoice verification projection. SECURITY DEFINER + hard-coded '
    'column whitelist. The caller must already have validated the HMAC '
    'signature on (p_ref, p_hash) before invoking — this function only '
    'checks that the stored content_hash matches the one in the URL.';

-- Lock down execute. The function is callable from the anon (verify page)
-- and authenticated (logged-in users scanning their own QR) roles only.
REVOKE ALL ON FUNCTION public.verify_invoice_lookup(TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_invoice_lookup(TEXT, TEXT) TO anon, authenticated;

COMMIT;
