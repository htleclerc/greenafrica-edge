import { NextRequest, NextResponse } from 'next/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { verifyPaystackSignature, verifyFlutterwaveSignature, verifyPayoneerSignature } from '@/services/paymentService';
import type { PaymentRail } from '@/services/paymentService';
import { writeAuditLog } from '@/services/auditService';
import { resolveSystemActor } from '@/lib/system-actor';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('payment-webhook');

/**
 * POST /api/webhooks/payment
 *
 * Unified webhook handler for Paystack / Flutterwave / Wave / Payoneer.
 * (Stripe uses its own dedicated /api/webhooks/stripe route.)
 *
 * PROVIDER DETECTION (header → provider):
 *   x-paystack-signature  → paystack
 *   verif-hash            → flutterwave
 *   x-wave-signature      → wave
 *   payoneer-signature    → payoneer
 *
 * REFERENCE MATCHING (per-provider canonical field → transactions.invoice_ref):
 *   Paystack:    body.data.reference  — equals invoiceRef passed to /transaction/initialize
 *   Flutterwave: body.data.tx_ref     — equals invoiceRef passed as tx_ref to /v3/payments
 *   Wave:        body.client_reference — equals invoiceRef passed as client_reference
 *   Payoneer:    body.reference_id (or body.data.reference_id) — equals invoiceRef
 *
 * All four providers echo back the exact invoiceRef string supplied at initiation.
 * We look it up via transactions.invoice_ref (unique index, mig 017) — no ilike prefix.
 * Unknown ref → log.warn + 200 {received:true, action:'unknown_reference'} (no retry storm).
 *
 * AMOUNT UNITS (normalised to USD major-unit float):
 *   Paystack:    body.data.amount in smallest unit (kobo for NGN, cents for USD) → divide by 100
 *   Flutterwave: body.data.amount in major units (e.g. USD → already dollars)
 *   Wave:        body.amount in major units (Wave API returns major units)
 *   Payoneer:    body.amount.value (string) in major units
 *
 * Only USD is accepted; any other currency triggers a mismatch rejection.
 * Tolerance: ±$0.01.
 *
 * RAIL ENUM (mig 048 payment_rail):
 *   Paystack / Flutterwave / Wave → MOBILE_MONEY  (mobile + card + bank in Africa)
 *   Payoneer                      → THIRD_PARTY   (B2B cross-border)
 *
 * PAYMENTS-ROW RAIL (mirrors Stripe webhook):
 *   1. Idempotency: already PAID transaction → skip; existing CONFIRMED payments row
 *      with same external_reference → skip.
 *   2. INSERT into payments (amount_usd_minor, rail, status='CONFIRMED', …).
 *   3. Call recompute_transaction_status RPC (mig 051) — derives tx status + paid_at.
 *   4. Audit via TRANSACTION_UPDATED + details_json.event='PAYMENT_RECEIVED'.
 *
 * Errors → log.error + 200 {received:true, action:'error_logged'} — never a 500 retry storm.
 *
 * NOTE: paymentService.confirmPayment() (legacy direct UPDATE) is no longer called by this
 * route. That function is deprecated — the payments-row + recompute rail is the correct path.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Tolerance for amount comparison: ±$0.01 USD
const AMOUNT_TOLERANCE_USD = 0.01;

interface ParsedPayload {
  provider: string;
  // The reference the provider echoes back — must match transactions.invoice_ref exactly
  invoiceRef: string;
  // Provider-side transaction/charge identifier for external_reference + idempotency
  providerRef: string;
  isSuccess: boolean;
  // Paid amount in USD (major units, normalised by caller); null means we couldn't parse it
  paidAmountUsd: number | null;
  paidCurrency: string | null;
  // DB rail enum value (mig 048)
  rail: PaymentRail;
}

function parsePaystackPayload(body: Record<string, unknown>): Omit<ParsedPayload, 'provider'> {
  const data = (body.data ?? {}) as Record<string, unknown>;
  // Paystack echoes back the reference we supplied at initialization
  const invoiceRef = String(data.reference ?? '');
  const providerRef = String(data.id ?? '');
  const isSuccess = body.event === 'charge.success';

  // Paystack amounts are always in smallest unit (kobo / cents)
  const rawAmount = data.amount;
  const rawCurrency = String(data.currency ?? '').toUpperCase();
  const paidAmountUsd = typeof rawAmount === 'number' ? rawAmount / 100 : null;
  const paidCurrency = rawCurrency || null;

  return { invoiceRef, providerRef, isSuccess, paidAmountUsd, paidCurrency, rail: 'MOBILE_MONEY' };
}

function parseFlutterwavePayload(body: Record<string, unknown>): Omit<ParsedPayload, 'provider'> {
  const data = (body.data ?? {}) as Record<string, unknown>;
  // Flutterwave echoes back the tx_ref we supplied at initialization
  const invoiceRef = String(data.tx_ref ?? '');
  const providerRef = String(data.id ?? '');
  const isSuccess = body.event === 'charge.completed' && data.status === 'successful';

  // Flutterwave amounts are in major units (USD → already dollars)
  const rawAmount = data.amount;
  const rawCurrency = String(data.currency ?? '').toUpperCase();
  const paidAmountUsd = typeof rawAmount === 'number' ? rawAmount : null;
  const paidCurrency = rawCurrency || null;

  return { invoiceRef, providerRef, isSuccess, paidAmountUsd, paidCurrency, rail: 'MOBILE_MONEY' };
}

// parseWavePayload intentionally omitted: Wave is disabled on this route (m1).
// Re-implement when re-enabling: read from body.data.* (real Wave webhook shape)
// and enforce XOF/SOS → USD FX conversion policy before accepting the payment.

function parsePayoneerPayload(body: Record<string, unknown>): Omit<ParsedPayload, 'provider'> {
  const data = (body.data ?? {}) as Record<string, unknown>;
  // Payoneer echoes back the reference_id we supplied at initialization
  const invoiceRef = String(body.reference_id ?? data.reference_id ?? '');
  const providerRef = String(body.id ?? data.id ?? '');
  const eventType = String(body.event_type ?? body.type ?? '');
  const isSuccess = eventType === 'charge.succeeded' || eventType === 'payment.completed';

  // Payoneer amount is an object: { value: "1250.00", currency: "USD" }
  const amountObj = (body.amount ?? data.amount ?? {}) as Record<string, unknown>;
  const rawValue = amountObj.value;
  const rawCurrency = String(amountObj.currency ?? '').toUpperCase();
  const paidAmountUsd = rawValue != null ? parseFloat(String(rawValue)) || null : null;
  const paidCurrency = rawCurrency || null;

  return { invoiceRef, providerRef, isSuccess, paidAmountUsd, paidCurrency, rail: 'THIRD_PARTY' };
}

export async function POST(request: NextRequest) {
  let provider = '(unknown)';
  // m2 — JSON parse failure is a malformed request, not a server error: return 400
  // (not 200 error_logged, which would suppress retries for a legitimate bad payload).
  const rawBody = await request.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const adminClient = createPlatformClient();

    // ── Detect provider + verify signature ───────────────────────────────
    const paystackSig = request.headers.get('x-paystack-signature');
    const flutterwaveSig = request.headers.get('verif-hash');
    const waveSig = request.headers.get('x-wave-signature');
    const payoneerSig = request.headers.get('payoneer-signature');

    let parsed: ParsedPayload;

    if (paystackSig) {
      if (!(await verifyPaystackSignature(rawBody, paystackSig))) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      provider = 'paystack';
      parsed = { provider, ...parsePaystackPayload(body) };

    } else if (flutterwaveSig) {
      if (!verifyFlutterwaveSignature(flutterwaveSig)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      provider = 'flutterwave';
      parsed = { provider, ...parseFlutterwavePayload(body) };

    } else if (waveSig) {
      // m1 — Wave is explicitly disabled on this route.
      // Reasons: (1) Wave only settles in XOF/SOS — we accept USD only, so every
      // real Wave webhook would dead-end at the currency check anyway; (2) the
      // actual Wave webhook payload nests event data under a `data` key while
      // parseWavePayload reads top-level fields, so the reference/amount would
      // always parse as empty/null. Re-enable with: FX policy for XOF↔USD +
      // updated parser reading body.data.* + integration tests against live sandbox.
      // Signature is still verified so we don't expose a 200-ack endpoint to
      // unauthenticated callers.
      const expectedWave = process.env.WAVE_WEBHOOK_SECRET;
      if (!expectedWave || waveSig !== expectedWave) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      log.info('wave_not_supported', {});
      return NextResponse.json({ received: true, action: 'wave_not_supported' });

    } else if (payoneerSig) {
      if (!(await verifyPayoneerSignature(rawBody, payoneerSig))) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      provider = 'payoneer';
      parsed = { provider, ...parsePayoneerPayload(body) };

    } else {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
    }

    // Non-success events (failures, notifications, etc.) acknowledged silently
    if (!parsed.isSuccess) {
      log.info('webhook_non_success_event', { provider: parsed.provider });
      return NextResponse.json({ received: true, provider: parsed.provider });
    }

    // ── Reference validation ─────────────────────────────────────────────
    if (!parsed.invoiceRef) {
      log.warn('webhook_missing_reference', { provider: parsed.provider });
      return NextResponse.json({ received: true, action: 'unknown_reference' });
    }

    // Exact match on invoice_ref (unique index, mig 017 idx_txn_invoice_ref).
    // ilike prefix matching is collision-prone and inconsistent with how refs are minted.
    const { data: txRows } = await adminClient
      .from('transactions')
      .select('id, vessel_id, vessel_name, tax_amount_usd, status, shipowner_id, jurisdiction_id')
      .eq('invoice_ref', parsed.invoiceRef)
      .limit(1);

    const tx = txRows && txRows.length > 0 ? txRows[0] : null;

    if (!tx) {
      // I4 — log provider, providerRef, and invoiceRef for manual replay of
      // paid-but-unrecorded payments. Provider txn IDs are not sensitive (same
      // policy as Stripe's stripePiId logging).
      log.warn('webhook_unknown_reference', {
        provider: parsed.provider,
        providerRef: parsed.providerRef,
        invoiceRef: parsed.invoiceRef,
      });
      return NextResponse.json({ received: true, action: 'unknown_reference' });
    }

    // ── Idempotency: already PAID ────────────────────────────────────────
    const txRecord = tx as {
      id: string;
      vessel_id: string;
      vessel_name: string;
      tax_amount_usd: number;
      status: string;
      shipowner_id: string | null;
      jurisdiction_id: string | null;
    };
    if (txRecord.status === 'PAID') {
      log.info('webhook_already_paid', { provider: parsed.provider, transactionId: txRecord.id });
      return NextResponse.json({ received: true, action: 'already_paid' });
    }

    // I3 — Defensive: a matched tx with NULL shipowner_id must never produce a
    // payment row (shipowner_id is a required FK on payments). Log and ack.
    if (!txRecord.shipowner_id) {
      log.error('webhook_null_shipowner', {
        provider: parsed.provider,
        transactionId: txRecord.id,
        invoiceRef: parsed.invoiceRef,
      });
      return NextResponse.json({ received: true, action: 'error_logged' });
    }

    // ── Idempotency: existing CONFIRMED payments row for this external ref ─
    // I2 — namespace external_reference as "{provider}:{providerRef}" to avoid
    // cross-provider integer-id collisions on the same rail (e.g. Paystack id=100
    // and Flutterwave id=100 are different charges). The DB unique index (mig 087)
    // enforces uniqueness on this namespaced value.
    const namespacedRef = parsed.providerRef ? `${parsed.provider}:${parsed.providerRef}` : null;

    if (namespacedRef) {
      const { data: existingPayment } = await adminClient
        .from('payments')
        .select('id, status')
        .eq('external_reference', namespacedRef)
        .eq('status', 'CONFIRMED')
        .maybeSingle();
      if (existingPayment) {
        log.info('webhook_payment_already_confirmed', {
          provider: parsed.provider,
          transactionId: txRecord.id,
          existingPaymentId: (existingPayment as { id: string }).id,
        });
        return NextResponse.json({ received: true, action: 'already_paid' });
      }
    }

    // ── Amount validation ────────────────────────────────────────────────
    // Only USD is accepted; FX conversion is never guessed on a fiscal payment.
    if (parsed.paidCurrency && parsed.paidCurrency !== 'USD') {
      log.error('payment_amount_mismatch', {
        provider: parsed.provider,
        transactionId: txRecord.id,
        reason: 'non_usd_currency',
        paidCurrency: parsed.paidCurrency,
        expectedCurrency: 'USD',
      });
      const systemActorId = await resolveSystemActor(adminClient);
      if (systemActorId) {
        await writeAuditLog(adminClient, {
          user_id: systemActorId,
          user_full_name: 'Payment Webhook',
          action: 'TRANSACTION_UPDATED',
          severity: 'WARNING',
          entity_type: 'Transaction',
          entity_id: txRecord.id,
          details_json: {
            event: 'PAYMENT_AMOUNT_MISMATCH',
            provider: parsed.provider,
            provider_ref: parsed.providerRef,
            reason: 'non_usd_currency',
            paid_currency: parsed.paidCurrency,
            expected_currency: 'USD',
          },
        });
      }
      return NextResponse.json({ received: true, action: 'rejected_amount_mismatch' });
    }

    if (parsed.paidAmountUsd === null || isNaN(parsed.paidAmountUsd)) {
      log.error('payment_amount_mismatch', {
        provider: parsed.provider,
        transactionId: txRecord.id,
        reason: 'unparseable_amount',
      });
      return NextResponse.json({ received: true, action: 'rejected_amount_mismatch' });
    }

    const expectedUsd: number = txRecord.tax_amount_usd;
    const diff = Math.abs(parsed.paidAmountUsd - expectedUsd);
    if (diff > AMOUNT_TOLERANCE_USD) {
      log.error('payment_amount_mismatch', {
        provider: parsed.provider,
        transactionId: txRecord.id,
        expectedUsd,
        receivedUsd: parsed.paidAmountUsd,
        diffUsd: diff,
      });
      const systemActorId = await resolveSystemActor(adminClient);
      if (systemActorId) {
        await writeAuditLog(adminClient, {
          user_id: systemActorId,
          user_full_name: 'Payment Webhook',
          action: 'TRANSACTION_UPDATED',
          severity: 'WARNING',
          entity_type: 'Transaction',
          entity_id: txRecord.id,
          details_json: {
            event: 'PAYMENT_AMOUNT_MISMATCH',
            provider: parsed.provider,
            provider_ref: parsed.providerRef,
            expected_usd: expectedUsd,
            received_usd: parsed.paidAmountUsd,
            diff_usd: diff,
          },
        });
      }
      return NextResponse.json({ received: true, action: 'rejected_amount_mismatch' });
    }

    // ── Resolve system actor for confirmed_by (NOT NULL when CONFIRMED) ──
    const systemActorId = await resolveSystemActor(adminClient);
    if (!systemActorId) {
      log.error('webhook_no_system_actor', { provider: parsed.provider, transactionId: txRecord.id });
      return NextResponse.json({ received: true, action: 'error_logged' });
    }

    // ── INSERT payments row ──────────────────────────────────────────────
    // amount_usd_minor: round(tax_amount_usd * 100) — use the authoritative DB value,
    // not the webhook-parsed amount (which we already validated is within tolerance).
    const amountUsdMinor = Math.round(expectedUsd * 100);
    const confirmedAt = new Date().toISOString();

    const { error: insertErr } = await adminClient
      .from('payments')
      .insert({
        transaction_id: txRecord.id,
        shipowner_id: txRecord.shipowner_id,
        // I1 — stamp the jurisdiction from the transaction row so a DJ payment
        // never inherits the mig-072 default (Somaliland).
        jurisdiction_id: txRecord.jurisdiction_id,
        declared_by: null,             // no human actor on webhook path
        amount_minor: amountUsdMinor,   // USD → minor = major * 100
        currency: 'USD',
        amount_usd_minor: amountUsdMinor,
        fx_rate: null,
        fx_rate_source: null,
        fx_rate_locked_at: null,
        rail: parsed.rail,
        rail_details: {
          provider: parsed.provider,
          provider_ref: parsed.providerRef,
        },
        // I2 — namespace as "{provider}:{providerRef}" to avoid cross-provider
        // integer-id collisions (Paystack id=100 ≠ Flutterwave id=100).
        external_reference: namespacedRef,
        status: 'CONFIRMED',
        confirmed_by: systemActorId,
        confirmed_at: confirmedAt,
      });

    if (insertErr) {
      log.error('webhook_payments_insert_failed', {
        provider: parsed.provider,
        transactionId: txRecord.id,
        error: insertErr.message,
      });
      return NextResponse.json({ received: true, action: 'error_logged' });
    }

    // ── Recompute transaction status (mig 051 RPC) ───────────────────────
    // The trigger on payments INSERT will also fire this, but we call it
    // explicitly to ensure status is derived before returning (Belt + suspenders).
    const { error: rpcErr } = await adminClient.rpc('recompute_transaction_status', {
      p_txn_id: txRecord.id,
    });
    if (rpcErr) {
      log.error('webhook_recompute_failed', {
        provider: parsed.provider,
        transactionId: txRecord.id,
        error: rpcErr.message,
      });
      // Payment row is already inserted and CONFIRMED — not catastrophic; log + continue.
    }

    // ── Audit ────────────────────────────────────────────────────────────
    await writeAuditLog(adminClient, {
      user_id: systemActorId,
      user_full_name: 'Payment Webhook',
      action: 'TRANSACTION_UPDATED',
      severity: 'INFO',
      entity_type: 'Transaction',
      entity_id: txRecord.id,
      details_json: {
        event: 'PAYMENT_RECEIVED',
        provider: parsed.provider,
        provider_ref: parsed.providerRef,
        amount_usd: expectedUsd,
        amount_usd_minor: amountUsdMinor,
        vessel: txRecord.vessel_name,
      },
    });

    log.info('webhook_payment_confirmed', {
      provider: parsed.provider,
      transactionId: txRecord.id,
      amountUsdMinor,
      rail: parsed.rail,
    });

    return NextResponse.json({ received: true, action: 'confirmed', provider: parsed.provider });

  } catch (e) {
    log.error('webhook_unhandled_error', {
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
    // 200 to avoid retry storms — error is logged.
    return NextResponse.json({ received: true, action: 'error_logged' });
  }
}
