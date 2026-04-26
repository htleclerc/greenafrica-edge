-- Migration 038: expose document_type from verify_invoice_lookup so the public
-- /verify page can render the right wording for each document flavor.
--
-- Why: the current verifier renders a single generic "Document Status" badge
-- regardless of whether the row is a PROFORMA estimate, a FINAL receipt, a
-- COMPLEMENT, or a REFUND. From the verifier's standpoint a proforma sitting
-- at status=PENDING ("To Pay") is fundamentally different from a FINAL
-- receipt sitting at status=PENDING ("Unpaid / In Default"), but the page
-- has no way to tell them apart because the RPC's RETURN signature doesn't
-- include `document_type`.
--
-- Postgres won't let CREATE OR REPLACE change a function's return type, so
-- this migration drops the existing function and recreates it with one
-- additional whitelisted column. The same SECURITY DEFINER + search_path
-- guarantees from migration 019 carry over.

BEGIN;

DROP FUNCTION IF EXISTS public.verify_invoice_lookup(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.verify_invoice_lookup(
    p_ref  TEXT,
    p_hash TEXT
)
RETURNS TABLE (
    invoice_ref        TEXT,
    content_hash       TEXT,
    document_type      TEXT,
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
    SELECT t.invoice_ref,
           t.content_hash,
           t.document_type::text,
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
    'checks that the stored content_hash matches the one in the URL. '
    'Returns document_type so the verifier can label PROFORMA vs FINAL '
    'vs COMPLEMENT vs REFUND with appropriate wording and payment status.';

REVOKE ALL ON FUNCTION public.verify_invoice_lookup(TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_invoice_lookup(TEXT, TEXT) TO anon, authenticated;

COMMIT;
