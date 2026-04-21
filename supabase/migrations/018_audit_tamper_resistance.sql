-- Migration 018: Defense-in-depth hardening after the Tier 1 security PR.
--
-- Two changes, both SQL-only:
--
--   H4 — audit_logs append-only trigger. Even the service_role key (used
--        by every server route) cannot UPDATE or DELETE rows in audit_logs
--        after this runs. A leaked service key can still INSERT fake
--        entries, but it cannot erase evidence of previous activity. This
--        raises the bar from "silent log rewrite" to "forward-only attack
--        surface," which is what forensic audits actually need.
--
--   M4 — restrict the documents bucket DELETE policy to SUPERADMIN only.
--        Before this, any PORT_OFFICER or FINANCE_ADMIN could delete any
--        invoice/receipt PDF. A compromised staff account could erase
--        historical PDFs while the transactions row remained, leaving
--        /verify pointing to a broken download. Only SUPERADMIN retains
--        hard-delete now; regular staff can still upload/replace.

BEGIN;

-- ── H4: audit_logs is append-only ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_logs_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only — % operation is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege',
              HINT    = 'Insert a compensating entry instead of modifying history.';
END;
$$ LANGUAGE plpgsql;

-- Separate UPDATE and DELETE triggers so the error message stays precise.
DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON public.audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_logs_append_only();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_no_delete
    BEFORE DELETE ON public.audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_logs_append_only();

COMMENT ON FUNCTION public.audit_logs_append_only IS
    'Raises on any UPDATE or DELETE to audit_logs. Applied via BEFORE triggers. '
    'Bypassing requires dropping the triggers, which is itself a DDL auditable '
    'event at the Postgres level.';

-- ── M4: tighten documents bucket DELETE to SUPERADMIN ──────────────────

DROP POLICY IF EXISTS "documents_delete_staff" ON storage.objects;
CREATE POLICY "documents_delete_superadmin"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'documents'
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND role = 'SUPERADMIN'
        )
    );

COMMIT;
