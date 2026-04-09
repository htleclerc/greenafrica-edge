import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Multi-Provider Payment Service — Admin-Configurable
 *
 * 5 providers, switchable at runtime via admin settings (payment_config table):
 * 1. Stripe     — International cards + SEPA (stripe.com)
 * 2. Paystack   — Africa cards + bank + mobile (paystack.com, owned by Stripe)
 * 3. Flutterwave — Africa + global (flutterwave.com)
 * 4. Wave       — Mobile money West/East Africa (wave.com)
 * 5. Wire       — SWIFT bank transfer (always available, no API)
 *
 * Admin can switch the active provider from /dashboard/settings without redeploying.
 * The active provider is stored in Supabase `payment_config` table.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type PaymentProvider = 'stripe' | 'paystack' | 'flutterwave' | 'wave' | 'wire_transfer';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'processing';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'XOF' | 'SOS' | 'KES' | 'NGN' | 'GHS';

export interface PaymentRequest {
  transactionId: string;
  amount: number;
  currency: Currency;
  invoiceRef: string;
  description: string;
  metadata: {
    vesselImo: string;
    vesselName: string;
    ownerEntity: string;
    jurisdiction: string;
    taxPeriod: string;
  };
  customerEmail?: string;
  customerPhone?: string;
}

export interface PaymentResult {
  paymentId: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  checkoutUrl?: string;
  providerRef?: string;
  wireInstructions?: WireTransferInstructions;
}

export interface WireTransferInstructions {
  beneficiary: string;
  bank: string;
  swiftCode: string;
  iban: string;
  reference: string;
  amount: string;
  currency: Currency;
}

export interface PaymentProviderConfig {
  provider: PaymentProvider;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
  supportedCurrencies: Currency[];
  testMode: boolean;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3300';

const successUrl = (ref: string) => `${APP_URL}/dashboard/invoices?payment=success&ref=${ref}`;
const cancelUrl = (ref: string) => `${APP_URL}/dashboard/invoices?payment=cancelled&ref=${ref}`;

// ── Provider Registry ───────────────────────────────────────────────────────

const PROVIDERS: Record<PaymentProvider, {
  displayName: string;
  currencies: Currency[];
  envKey: string;
}> = {
  stripe: {
    displayName: 'Stripe (Cards + SEPA)',
    currencies: ['USD', 'EUR', 'GBP'],
    envKey: 'STRIPE_SECRET_KEY',
  },
  paystack: {
    displayName: 'Paystack (Africa Cards + Bank)',
    currencies: ['USD', 'NGN', 'GHS', 'KES'],
    envKey: 'PAYSTACK_SECRET_KEY',
  },
  flutterwave: {
    displayName: 'Flutterwave (Africa + Global)',
    currencies: ['USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'XOF'],
    envKey: 'FLUTTERWAVE_SECRET_KEY',
  },
  wave: {
    displayName: 'Wave Mobile Money',
    currencies: ['XOF', 'SOS'],
    envKey: 'WAVE_API_KEY',
  },
  wire_transfer: {
    displayName: 'Wire Transfer (SWIFT)',
    currencies: ['USD', 'EUR', 'GBP', 'XOF', 'SOS', 'KES', 'NGN', 'GHS'],
    envKey: '',
  },
};

// ── Stripe ──────────────────────────────────────────────────────────────────

async function createStripePayment(payment: PaymentRequest): Promise<PaymentResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return fail('stripe', payment.invoiceRef);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      'mode': 'payment',
      'currency': payment.currency.toLowerCase(),
      'line_items[0][price_data][currency]': payment.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(Math.round(payment.amount * 100)),
      'line_items[0][price_data][product_data][name]': `Carbon Tax — ${payment.metadata.vesselName}`,
      'line_items[0][quantity]': '1',
      'client_reference_id': payment.invoiceRef,
      'customer_email': payment.customerEmail || '',
      'success_url': successUrl(payment.invoiceRef),
      'cancel_url': cancelUrl(payment.invoiceRef),
      'metadata[transaction_id]': payment.transactionId,
      'metadata[vessel_imo]': payment.metadata.vesselImo,
      'payment_method_types[0]': 'card',
    }),
  });

  if (!res.ok) return fail('stripe', payment.invoiceRef);
  const session = await res.json();
  return ok('stripe', session.id, session.url);
}

// ── Paystack ────────────────────────────────────────────────────────────────

async function createPaystackPayment(payment: PaymentRequest): Promise<PaymentResult> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return fail('paystack', payment.invoiceRef);

  // Paystack amounts in smallest unit (kobo for NGN, cents for USD/GHS/KES)
  const amountSmallest = Math.round(payment.amount * 100);

  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: payment.customerEmail || 'payment@africgreen.gov.sl',
      amount: amountSmallest,
      currency: payment.currency,
      reference: payment.invoiceRef,
      callback_url: successUrl(payment.invoiceRef),
      metadata: {
        transaction_id: payment.transactionId,
        vessel_imo: payment.metadata.vesselImo,
        vessel_name: payment.metadata.vesselName,
        owner_entity: payment.metadata.ownerEntity,
        jurisdiction: payment.metadata.jurisdiction,
        tax_period: payment.metadata.taxPeriod,
        custom_fields: [
          { display_name: 'Vessel', variable_name: 'vessel', value: payment.metadata.vesselName },
          { display_name: 'IMO', variable_name: 'imo', value: payment.metadata.vesselImo },
          { display_name: 'Invoice', variable_name: 'invoice', value: payment.invoiceRef },
        ],
      },
      channels: ['card', 'bank', 'bank_transfer', 'mobile_money'],
    }),
  });

  if (!res.ok) return fail('paystack', payment.invoiceRef);
  const data = await res.json();

  if (!data.status || !data.data) return fail('paystack', payment.invoiceRef);

  return ok('paystack', data.data.reference, data.data.authorization_url);
}

// ── Flutterwave ─────────────────────────────────────────────────────────────

async function createFlutterwavePayment(payment: PaymentRequest): Promise<PaymentResult> {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) return fail('flutterwave', payment.invoiceRef);

  const res = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tx_ref: payment.invoiceRef,
      amount: payment.amount,
      currency: payment.currency,
      redirect_url: successUrl(payment.invoiceRef),
      customer: {
        email: payment.customerEmail || 'payment@africgreen.gov.sl',
        phonenumber: payment.customerPhone || '',
        name: payment.metadata.ownerEntity,
      },
      customizations: {
        title: 'AfricgreenOS — Carbon Tax Payment',
        description: `Carbon Tax Invoice ${payment.invoiceRef} — ${payment.metadata.vesselName}`,
        logo: `${APP_URL}/logo.png`,
      },
      meta: {
        transaction_id: payment.transactionId,
        vessel_imo: payment.metadata.vesselImo,
        vessel_name: payment.metadata.vesselName,
        jurisdiction: payment.metadata.jurisdiction,
        tax_period: payment.metadata.taxPeriod,
      },
      payment_options: 'card, banktransfer, mobilemoney, ussd',
    }),
  });

  if (!res.ok) return fail('flutterwave', payment.invoiceRef);
  const data = await res.json();

  if (data.status !== 'success' || !data.data) return fail('flutterwave', payment.invoiceRef);

  return ok('flutterwave', payment.invoiceRef, data.data.link);
}

// ── Wave Mobile Money ───────────────────────────────────────────────────────

async function createWavePayment(payment: PaymentRequest): Promise<PaymentResult> {
  const key = process.env.WAVE_API_KEY;
  if (!key) return fail('wave', payment.invoiceRef);

  const res = await fetch('https://api.wave.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: payment.amount,
      currency: payment.currency,
      error_url: cancelUrl(payment.invoiceRef),
      success_url: successUrl(payment.invoiceRef),
      client_reference: payment.invoiceRef,
    }),
  });

  if (!res.ok) return fail('wave', payment.invoiceRef);
  const data = await res.json();
  return ok('wave', data.id, data.wave_launch_url || data.checkout_url);
}

// ── Wire Transfer ───────────────────────────────────────────────────────────

function createWireTransfer(payment: PaymentRequest): PaymentResult {
  const ref = `AG/${payment.invoiceRef}/${payment.metadata.vesselImo}/${payment.metadata.taxPeriod}`;

  return {
    paymentId: `WIRE-${payment.invoiceRef}`,
    provider: 'wire_transfer',
    status: 'pending',
    wireInstructions: {
      beneficiary: 'AfricGreen Maritime Carbon Tax Authority',
      bank: 'International Bank of Somaliland',
      swiftCode: 'IBSLSLMG',
      iban: 'SL00 0000 0000 0000 0000 00',
      reference: ref,
      amount: `${payment.currency} ${payment.amount.toFixed(2)}`,
      currency: payment.currency,
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(provider: PaymentProvider, id: string, url?: string): PaymentResult {
  return { paymentId: id, provider, status: 'pending', checkoutUrl: url, providerRef: id };
}

function fail(provider: PaymentProvider, ref: string): PaymentResult {
  return { paymentId: `${provider.toUpperCase()}-ERR-${ref}`, provider, status: 'failed' };
}

const PROVIDER_HANDLERS: Record<PaymentProvider, (p: PaymentRequest) => Promise<PaymentResult> | PaymentResult> = {
  stripe: createStripePayment,
  paystack: createPaystackPayment,
  flutterwave: createFlutterwavePayment,
  wave: createWavePayment,
  wire_transfer: createWireTransfer,
};

// ── Admin Config (DB-driven) ────────────────────────────────────────────────

/**
 * Get the active payment provider from the payment_config table.
 * Falls back to wire_transfer if no config exists.
 */
export async function getActiveProvider(client: SupabaseClient): Promise<PaymentProvider> {
  const { data } = await client
    .from('payment_config')
    .select('provider')
    .eq('is_active', true)
    .limit(1)
    .single();

  return (data?.provider as PaymentProvider) || 'wire_transfer';
}

/**
 * Get all provider configurations for the admin settings page.
 */
export async function getAllProviderConfigs(client: SupabaseClient): Promise<PaymentProviderConfig[]> {
  const { data: dbConfigs } = await client
    .from('payment_config')
    .select('*')
    .order('display_order');

  // Merge DB config with static provider registry
  return Object.entries(PROVIDERS).map(([key, meta]) => {
    const dbRow = dbConfigs?.find((c: { provider: string }) => c.provider === key);
    const hasEnvKey = key === 'wire_transfer' || !!process.env[meta.envKey];

    return {
      provider: key as PaymentProvider,
      displayName: meta.displayName,
      enabled: dbRow?.is_enabled ?? (key === 'wire_transfer'),
      isDefault: dbRow?.is_active ?? (key === 'wire_transfer'),
      supportedCurrencies: meta.currencies,
      testMode: dbRow?.test_mode ?? false,
    };
  });
}

/**
 * Set the active payment provider (admin action).
 */
export async function setActiveProvider(
  client: SupabaseClient,
  provider: PaymentProvider,
): Promise<boolean> {
  // Deactivate all
  await client.from('payment_config').update({ is_active: false }).neq('id', '');

  // Activate the selected one (upsert)
  const { error } = await client.from('payment_config').upsert(
    {
      provider,
      is_active: true,
      is_enabled: true,
      display_name: PROVIDERS[provider]?.displayName || provider,
    },
    { onConflict: 'provider' },
  );

  return !error;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a payment using the admin-configured active provider.
 * If overrideProvider is specified, uses that instead.
 */
export async function createPaymentRequest(
  client: SupabaseClient,
  payment: PaymentRequest,
  overrideProvider?: PaymentProvider,
): Promise<PaymentResult> {
  const provider = overrideProvider || await getActiveProvider(client);
  const handler = PROVIDER_HANDLERS[provider];

  if (!handler) return createWireTransfer(payment);

  try {
    return await handler(payment);
  } catch {
    // Fallback to wire if provider fails
    return createWireTransfer(payment);
  }
}

/**
 * Confirm payment: mark transaction PAID + vessel COMPLIANT.
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

  if (error) return false;

  const { data: tx } = await client
    .from('transactions')
    .select('vessel_id')
    .eq('id', transactionId)
    .single();

  if (tx) {
    await client.from('vessels').update({ compliance_status: 'COMPLIANT' }).eq('id', tx.vessel_id);
  }

  return true;
}

/**
 * Verify a Paystack webhook signature.
 */
export function verifyPaystackSignature(body: string, signature: string): boolean {
  const crypto = require('crypto');
  const secret = process.env.PAYSTACK_SECRET_KEY || '';
  const hash = crypto.createHmac('sha512', secret).update(body).digest('hex');
  return hash === signature;
}

/**
 * Verify a Flutterwave webhook signature.
 */
export function verifyFlutterwaveSignature(signature: string): boolean {
  return signature === process.env.FLUTTERWAVE_WEBHOOK_HASH;
}
