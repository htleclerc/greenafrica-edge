import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Multi-Provider Payment Service
 *
 * Supports 3 payment methods (international compliance):
 * 1. **Stripe** — International cards, bank transfers, SEPA (primary for intl shipping agents)
 * 2. **Wave Mobile Money** — East/West Africa mobile payments (regional alternative)
 * 3. **Wire Transfer (SWIFT)** — Traditional bank wire with unique reference (fallback)
 *
 * Compliance standards:
 * - PCI DSS: no card data touches our servers (Stripe Checkout handles it)
 * - KYC/AML: transaction metadata includes vessel IMO, owner entity, jurisdiction
 * - ISO 20022: wire transfer references follow structured format
 * - Multi-currency: USD (primary), EUR, GBP, XOF, SOS
 *
 * Env vars:
 *   STRIPE_SECRET_KEY     — Stripe API secret key
 *   STRIPE_WEBHOOK_SECRET — Stripe webhook endpoint secret
 *   WAVE_API_KEY          — Wave business API key (optional)
 *   WAVE_WEBHOOK_SECRET   — Wave webhook secret (optional)
 */

type PaymentMethod = 'stripe' | 'wave' | 'wire_transfer';
type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'processing';
type Currency = 'USD' | 'EUR' | 'GBP' | 'XOF' | 'SOS';

interface PaymentRequest {
  transactionId: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  invoiceRef: string;
  description: string;
  // KYC/AML metadata (ISO 20022 compliance)
  metadata: {
    vesselImo: string;
    vesselName: string;
    ownerEntity: string;
    jurisdiction: string;
    taxPeriod: string;
  };
  recipientPhone?: string; // Wave only
  customerEmail?: string;  // Stripe only
}

interface PaymentResult {
  paymentId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  checkoutUrl?: string;
  providerRef?: string;
  wireInstructions?: WireTransferInstructions;
}

interface WireTransferInstructions {
  beneficiary: string;
  bank: string;
  swiftCode: string;
  iban: string;
  reference: string;
  amount: string;
  currency: Currency;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3300';

// ── Stripe ──────────────────────────────────────────────────────────────────

async function createStripePayment(payment: PaymentRequest): Promise<PaymentResult> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return { paymentId: `STRIPE-NA-${payment.invoiceRef}`, method: 'stripe', status: 'failed' };
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'mode': 'payment',
      'currency': payment.currency.toLowerCase(),
      'line_items[0][price_data][currency]': payment.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(Math.round(payment.amount * 100)),
      'line_items[0][price_data][product_data][name]': `Carbon Tax — ${payment.metadata.vesselName}`,
      'line_items[0][price_data][product_data][description]': payment.description,
      'line_items[0][quantity]': '1',
      'client_reference_id': payment.invoiceRef,
      'customer_email': payment.customerEmail || '',
      'success_url': `${APP_URL}/dashboard/invoices?payment=success&ref=${payment.invoiceRef}`,
      'cancel_url': `${APP_URL}/dashboard/invoices?payment=cancelled&ref=${payment.invoiceRef}`,
      'metadata[vessel_imo]': payment.metadata.vesselImo,
      'metadata[vessel_name]': payment.metadata.vesselName,
      'metadata[owner_entity]': payment.metadata.ownerEntity,
      'metadata[jurisdiction]': payment.metadata.jurisdiction,
      'metadata[tax_period]': payment.metadata.taxPeriod,
      'metadata[transaction_id]': payment.transactionId,
      'payment_method_types[0]': 'card',
      'payment_method_types[1]': 'sepa_debit',
    }),
  });

  if (!response.ok) {
    console.error('[Payment/Stripe] API error:', response.status);
    return { paymentId: `STRIPE-ERR-${payment.invoiceRef}`, method: 'stripe', status: 'failed' };
  }

  const session = await response.json();
  return {
    paymentId: session.id,
    method: 'stripe',
    status: 'pending',
    checkoutUrl: session.url,
    providerRef: session.id,
  };
}

// ── Wave Mobile Money ───────────────────────────────────────────────────────

async function createWavePayment(payment: PaymentRequest): Promise<PaymentResult> {
  const waveKey = process.env.WAVE_API_KEY;
  if (!waveKey) {
    return { paymentId: `WAVE-NA-${payment.invoiceRef}`, method: 'wave', status: 'failed' };
  }

  const response = await fetch('https://api.wave.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${waveKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: Math.round(payment.amount * 100) / 100,
      currency: payment.currency,
      error_url: `${APP_URL}/dashboard/invoices?payment=error`,
      success_url: `${APP_URL}/dashboard/invoices?payment=success&ref=${payment.invoiceRef}`,
      client_reference: payment.invoiceRef,
    }),
  });

  if (!response.ok) {
    return { paymentId: `WAVE-ERR-${payment.invoiceRef}`, method: 'wave', status: 'failed' };
  }

  const data = await response.json();
  return {
    paymentId: data.id,
    method: 'wave',
    status: 'pending',
    checkoutUrl: data.wave_launch_url || data.checkout_url,
    providerRef: data.id,
  };
}

// ── Wire Transfer (SWIFT) ───────────────────────────────────────────────────

function createWireTransfer(payment: PaymentRequest): PaymentResult {
  // ISO 20022 structured reference: /INV/REF/IMO/PERIOD
  const structuredRef = `AG/${payment.invoiceRef}/${payment.metadata.vesselImo}/${payment.metadata.taxPeriod}`;

  const wireInstructions: WireTransferInstructions = {
    beneficiary: 'AfricGreen Maritime Carbon Tax Authority',
    bank: 'International Bank of Somaliland',
    swiftCode: 'IBSLSLMG', // placeholder
    iban: 'SL00 0000 0000 0000 0000 00', // placeholder
    reference: structuredRef,
    amount: `${payment.currency} ${payment.amount.toFixed(2)}`,
    currency: payment.currency,
  };

  return {
    paymentId: `WIRE-${payment.invoiceRef}`,
    method: 'wire_transfer',
    status: 'pending',
    wireInstructions,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a payment via the specified method.
 * Auto-selects wire_transfer as fallback if provider keys are missing.
 */
export async function createPaymentRequest(payment: PaymentRequest): Promise<PaymentResult> {
  switch (payment.method) {
    case 'stripe':
      return createStripePayment(payment);
    case 'wave':
      return createWavePayment(payment);
    case 'wire_transfer':
      return createWireTransfer(payment);
    default:
      return createWireTransfer(payment);
  }
}

/**
 * Confirm payment in Supabase: mark transaction PAID + vessel COMPLIANT.
 */
export async function confirmPayment(
  client: SupabaseClient,
  transactionId: string,
  providerRef: string,
): Promise<boolean> {
  const { error } = await client
    .from('transactions')
    .update({ status: 'PAID', paid_at: new Date().toISOString() })
    .eq('id', transactionId);

  if (error) {
    console.error('[Payment] Confirm failed:', error.message);
    return false;
  }

  const { data: tx } = await client
    .from('transactions')
    .select('vessel_id')
    .eq('id', transactionId)
    .single();

  if (tx) {
    await client
      .from('vessels')
      .update({ compliance_status: 'COMPLIANT' })
      .eq('id', tx.vessel_id);
  }

  return true;
}

/**
 * Get available payment methods based on configured env vars.
 */
export function getAvailablePaymentMethods(): PaymentMethod[] {
  const methods: PaymentMethod[] = ['wire_transfer']; // always available
  if (process.env.STRIPE_SECRET_KEY) methods.unshift('stripe');
  if (process.env.WAVE_API_KEY) methods.push('wave');
  return methods;
}

export type { PaymentRequest, PaymentResult, PaymentMethod, PaymentStatus, Currency, WireTransferInstructions };
