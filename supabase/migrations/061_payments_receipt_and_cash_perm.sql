-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 061: Receipt tracking on payments + cash-desk sub-permission
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Plan 7C-4 wires automatic receipt PDF generation into the confirmPayment
-- flow. Each CONFIRMED payment ends up with a unique RCT-YYYY-XXXX receipt
-- ref, a stored PDF in Supabase Storage 'documents' bucket, and a generation
-- timestamp for idempotency.
--
-- The new profiles.can_record_cash boolean lets PORT_OFFICER (or any admin
-- role) be granted access to the /admin/cash-desk page where they record
-- in-person cash payments rapidly. FINANCE_ADMIN/SUPERADMIN bypass this
-- gate via their role permissions.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS receipt_ref           TEXT,
    ADD COLUMN IF NOT EXISTS receipt_storage_path  TEXT,
    ADD COLUMN IF NOT EXISTS receipt_generated_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.payments.receipt_ref IS
    'RCT-YYYY-XXXX human-readable receipt reference. Unique when set; NULL until receipt generated.';
COMMENT ON COLUMN public.payments.receipt_storage_path IS
    'Path in the Supabase Storage `documents` bucket (e.g. receipts/RCT-2026-ABCD.pdf).';
COMMENT ON COLUMN public.payments.receipt_generated_at IS
    'Set on first successful generation. Idempotency key: skip generation if NOT NULL.';

-- Partial unique index: NULL allowed multiple times, non-NULL must be unique
CREATE UNIQUE INDEX IF NOT EXISTS payments_receipt_ref_unique
    ON public.payments (receipt_ref)
    WHERE receipt_ref IS NOT NULL;

-- Cash-desk sub-permission. Default false — must be granted explicitly per
-- profile by a SUPERADMIN. FINANCE_ADMIN and SUPERADMIN bypass this in the
-- application layer (rbac.ts predicate `canRecordCash`).
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_record_cash BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.can_record_cash IS
    'Sub-permission gating /admin/cash-desk for PORT_OFFICER. FINANCE_ADMIN/SUPERADMIN bypass via role.';
