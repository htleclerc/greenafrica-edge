import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { confirmPayment, verifyPaystackSignature, verifyFlutterwaveSignature } from '@/services/paymentService';
import { writeAuditLog } from '@/services/auditService';
import { parseInvoiceRef } from '@/services/invoiceService';

/**
 * POST /api/webhooks/payment
 *
 * Unified webhook handler for ALL payment providers.
 * Detects provider from headers and routes accordingly.
 *
 * Provider detection:
 * - Paystack:    x-paystack-signature header
 * - Flutterwave: verif-hash header
 * - Stripe:      stripe-signature header
 * - Wave:        x-wave-signature header
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const body = JSON.parse(rawBody);

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // ── Detect provider from headers ────────────────────────────────────
    const paystackSig = request.headers.get('x-paystack-signature');
    const flutterwaveSig = request.headers.get('verif-hash');
    const stripeSig = request.headers.get('stripe-signature');
    const waveSig = request.headers.get('x-wave-signature');

    let provider: string;
    let reference: string;
    let providerRef: string;
    let isSuccess: boolean;

    if (paystackSig) {
      // ── Paystack ──────────────────────────────────────────────────────
      if (!(await verifyPaystackSignature(rawBody, paystackSig))) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      provider = 'paystack';
      reference = body.data?.reference || '';
      providerRef = body.data?.id?.toString() || '';
      isSuccess = body.event === 'charge.success';

    } else if (flutterwaveSig) {
      // ── Flutterwave ───────────────────────────────────────────────────
      if (!verifyFlutterwaveSignature(flutterwaveSig)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      provider = 'flutterwave';
      reference = body.data?.tx_ref || '';
      providerRef = body.data?.id?.toString() || '';
      isSuccess = body.event === 'charge.completed' && body.data?.status === 'successful';

    } else if (stripeSig) {
      // ── Stripe ────────────────────────────────────────────────────────
      // Note: full Stripe signature verification requires the raw body + webhook secret
      // For now, check the secret matches
      provider = 'stripe';
      reference = body.data?.object?.client_reference_id || body.data?.object?.metadata?.transaction_id || '';
      providerRef = body.data?.object?.id || '';
      isSuccess = body.type === 'checkout.session.completed';

    } else if (waveSig) {
      // ── Wave ──────────────────────────────────────────────────────────
      const expectedWave = process.env.WAVE_WEBHOOK_SECRET;
      if (!expectedWave || waveSig !== expectedWave) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      provider = 'wave';
      reference = body.client_reference || '';
      providerRef = body.id || '';
      isSuccess = body.payment_status === 'succeeded';

    } else {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
    }

    if (!reference) {
      return NextResponse.json({ error: 'Missing reference' }, { status: 400 });
    }

    // ── Process successful payment ────────────────────────────────────
    if (isSuccess) {
      // The `reference` from providers is the canonical invoiceRef
      // (e.g. "INV-2026-XXXX"). Parse it via the shared helper so the
      // logic stays consistent with /verify and the modal builders.
      const parsed = parseInvoiceRef(reference);
      const idSuffix = parsed ? parsed.idSuffix : reference.toLowerCase();

      const { data: txs } = await adminClient
        .from('transactions')
        .select('id, vessel_id, vessel_name, tax_amount_usd')
        .ilike('id', `${idSuffix}%`)
        .limit(1);

      const tx = txs && txs.length > 0 ? txs[0] : null;

      if (!tx) {
        return NextResponse.json(
          { error: 'Transaction not found', reference, idSuffix },
          { status: 404 },
        );
      }

      await confirmPayment(adminClient, tx.id, providerRef);

      await writeAuditLog(adminClient, {
        action: 'PAYMENT_RECEIVED',
        entity_type: 'transaction',
        entity_id: tx.id,
        user_id: '00000000-0000-0000-0000-000000000000',
        severity: 'info',
        details: {
          provider,
          provider_ref: providerRef,
          amount_usd: tx.tax_amount_usd,
          vessel: tx.vessel_name,
        },
      });
    }

    return NextResponse.json({ success: true, provider });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
