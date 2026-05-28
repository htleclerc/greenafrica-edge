# Payment Proof Upload — Design Spec

**Date:** 2026-05-28
**Status:** Approved (pending written-spec review)
**Author:** Loic Leclerc + Claude

## Goal

Let a shipowner ("armateur") upload one or more proofs of payment (typically a
SWIFT **MT103** PDF/image) after initiating a wire transfer for a carbon-tax
invoice. **An admin must always validate the proof before the invoice/payment is
marked paid** — uploading a proof never auto-confirms payment.

The feature ships on **both** payment surfaces (Approach A — two thin,
independent paths):

- **v7 owner portal** (`/owner/invoices`) — where real ACTIVE shipowners land.
- **Legacy** (`/dashboard/invoices`) — staff/agents + demo accounts that bypass
  the middleware redirect.

## Non-Goals

- No auto-confirmation of payment on upload.
- No OCR / automatic MT103 parsing.
- No change to the Stripe / online-checkout rails (proofs are a wire-transfer concern).
- No unification of legacy onto the v7 `payments` model (explicitly rejected — Approach B).

## Shared Constraints (reuse existing infra)

- Storage bucket: **`payment-proofs`** (private, created in mig 059).
- Allowed MIME: PDF, PNG, JPEG, WebP (reuse `ALLOWED_PROOF_MIME_TYPES`).
- Max size: **5 MB** (matches `payment_proofs.size_bytes` CHECK).
- Multiple proofs per payment/invoice, **addable and removable while pending
  admin validation**.
- All proof writes go through server routes using the **service-role** client
  (both `payment_proofs` table and the bucket are RLS-with-zero-policies →
  no direct client access). Ownership is verified in the route before any write.

---

## Path 1 — v7 owner portal (`/owner/invoices`)

### Storage
Reuse `payment_proofs` (1:N via `payment_id` FK) + `paymentProofService`
(`uploadProof`, `listProofs`, `signedProofUrl`). **No migration needed.**

### Routes (new)
- `POST /api/owner/payments/[id]/proofs` — FormData `file` (+ optional `description`).
  - Auth: `requireOwner()`.
  - Verify `payment.shipowner_id === session.shipowner.id` AND
    `payment.status ∈ {INITIATED, PROCESSING}` (cannot attach to a
    confirmed/rejected/cancelled payment).
  - Validate MIME + size. Upload via service-role → insert `payment_proofs` row.
  - On FIRST proof: flip `INITIATED → PROCESSING` (signal "proof submitted,
    awaiting verification").
  - Emit owner notification `PROOF_SUBMITTED` (best-effort, fail-soft).
- `DELETE /api/owner/payments/[id]/proofs/[proofId]` —
  - Same ownership + status guard.
  - Delete storage object + `payment_proofs` row.
  - If it was the LAST proof: revert `PROCESSING → INITIATED`.

### UI
- **Entry point 1 — `PayDialog`:** after a WIRE_TRANSFER payment is confirmed
  (`initiatePayment` returns the payment `id`), show a final step "Upload your
  MT103" with multi-file add + per-file remove. Optional to upload now.
- **Entry point 2 — `InvoicesTable` row:** an "Attach / manage proof" action on
  rows that have an `INITIATED`/`PROCESSING` WIRE payment. The owner invoices
  page (`page.tsx`) already queries `payments`; extend the query to fetch pending
  wire payments + their proof counts so the table can render the action and
  current proof list.

### Admin validation
- `PaymentReviewDrawer` (`/admin/payments`) lists the payment's proofs with a
  short-lived signed URL per file (`listProofs` + `signedProofUrl`). The admin
  reviews the MT103 against the bank statement, then uses the existing
  `confirmPayment` action → `CONFIRMED` → transaction `PAID`.
- Confirm: `confirmPayment` must accept a `PROCESSING` payment (verify; it
  already handles INITIATED — extend if needed).

---

## Path 2 — legacy (`/dashboard/invoices`)

### Migration (new)
Add to `public.transactions`:
- `payment_proof_files JSONB NOT NULL DEFAULT '[]'::jsonb` — array of
  `{ path, mime_type, size_bytes, uploaded_at }`.

DOWN block drops the column.

(No separate timestamp column — each array entry carries its own `uploaded_at`.)

### Route (new)
- `POST /api/transactions/[id]/proof` — FormData `file`.
  - Verify the logged-in user owns the transaction (via `vessel.owner_id`).
  - Validate MIME + size.
  - Upload via service-role to `payment-proofs` under `legacy/<transactionId>/<ts>-<name>`.
  - Append an entry to `transactions.payment_proof_files`.
  - **Transaction stays `PENDING`** (admin validates later).
  - Audit log `PAYMENT_PROOF_UPLOADED`.
- `DELETE /api/transactions/[id]/proof?path=<path>` —
  - Same ownership guard. Remove storage object + array entry. Allowed only
    while transaction status is `PENDING`/`OVERDUE` (not after PAID).

### UI
- Upload + list/remove control inside `WireTransferModal` (below the wire
  instructions we just added).
- A "Proof submitted" badge on the invoice row / detail panel when
  `payment_proof_files` is non-empty.

### Admin validation
- Proof download link(s) in the admin invoice detail panel and in
  `RecordPaymentModal`. The admin reviews, then validates via the existing
  `mark-paid` flow → `PAID`.

---

## i18n
EN + FR for both surfaces: upload labels, states (uploading / submitted /
size-or-format error), MT103 note, "Proof submitted" badge, delete confirm.

## Error handling
- Reject bad MIME/size at the route with a 400 + explicit message (surfaced in UI).
- Upload failures are atomic: if the storage upload fails, no DB row/array entry
  is written; if the DB write fails after upload, the orphan object is best-effort
  deleted.
- Notification failure (v7) never rolls back the proof write (fail-soft).

## Testing
- **v7 route:** ownership refused for a different shipowner; bad format/size
  rejected; first-upload flips INITIATED→PROCESSING; delete of last proof reverts
  to INITIATED; cannot attach to CONFIRMED/REJECTED payment.
- **legacy route:** ownership enforced; array append/remove; status untouched
  (stays PENDING); cannot upload after PAID.
- **Admin:** `PaymentReviewDrawer` renders proof list + signed URL (update existing test).
- **Migration:** DOWN drops the column cleanly.
- No regressions in existing `paymentService` / `WireTransferModal` /
  `PaymentReviewDrawer` tests.

## Files (anticipated)

**New**
- `frontend/src/app/api/owner/payments/[id]/proofs/route.ts` (POST)
- `frontend/src/app/api/owner/payments/[id]/proofs/[proofId]/route.ts` (DELETE)
- `frontend/src/app/api/transactions/[id]/proof/route.ts` (POST + DELETE)
- `supabase/migrations/069_transaction_payment_proof_files.sql`
- A small reusable `<ProofUploader>` component (multi-file add/remove + states)
  shared by `PayDialog` and `WireTransferModal`.

**Modified**
- `frontend/src/components/owner/PayDialog/StepConfirm.tsx` (post-confirm proof step)
- `frontend/src/app/owner/(portal)/invoices/page.tsx` (fetch pending wire payments + proof counts)
- `frontend/src/app/owner/(portal)/invoices/InvoicesTable.tsx` (attach-proof action)
- `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer/*` (proof list + signed URL)
- `frontend/src/components/dashboard/invoices/WireTransferModal.tsx` (uploader)
- `frontend/src/components/dashboard/invoices/InvoicesPage.tsx` (proof badge + admin download link)
- `frontend/src/components/dashboard/invoices/RecordPaymentModal.tsx` (admin proof links)
- `frontend/src/services/paymentProofService.ts` (legacy-path helpers if needed)
- i18n message catalogs (EN + FR)
- `confirmPayment` action (accept PROCESSING if not already)

## Open questions
None — design approved. Pending user review of this written spec.
