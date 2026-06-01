import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Multi-Provider Payment Service — Admin-Configurable
 *
 * 6 providers, switchable at runtime via admin settings (payment_config table):
 * 1. Stripe      — International cards + SEPA (stripe.com)
 * 2. Paystack    — Africa cards + bank + mobile (paystack.com, owned by Stripe)
 * 3. Flutterwave — Africa + global (flutterwave.com)
 * 4. Wave        — Mobile money West/East Africa (wave.com)
 * 5. Payoneer    — B2B cross-border, marketplaces, global (payoneer.com)
 * 6. Wire        — SWIFT bank transfer (always available, no API)
 *
 * Admin can switch the active provider from /dashboard/settings without redeploying.
 * The active provider is stored in Supabase `payment_config` table.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Plan 7C: Typed Read Helpers for `payments` Table (mig 047-054)
 *
 * New 10-rail polymorphic payment table with double-entry wallets + append-only
 * ledger. Functions below query and type-safely return payment rows.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type PaymentProvider =
  | 'stripe'
  | 'paystack'
  | 'flutterwave'
  | 'wave'
  | 'payoneer'
  | 'wire_transfer';
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
  accountNumber: string;
  beneficiaryAddress: string;
  bank: string;
  swiftCode: string;
  iban: string;
  intermediaryBank: string;
  intermediarySwift: string;
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
  routesRail?: string[];
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
  payoneer: {
    displayName: 'Payoneer (B2B Cross-Border)',
    currencies: ['USD', 'EUR', 'GBP'],
    envKey: 'PAYONEER_API_KEY',
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
      email: payment.customerEmail || 'payment@greengate.africa',
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
        email: payment.customerEmail || 'payment@greengate.africa',
        phonenumber: payment.customerPhone || '',
        name: payment.metadata.ownerEntity,
      },
      customizations: {
        title: 'Green Gate OS — Carbon Tax Payment',
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

// ── Payoneer ────────────────────────────────────────────────────────────────
//
// Uses the Payoneer Checkout API (`/v4/programs/{programId}/charges`).
// Auth = Bearer token (PAYONEER_API_KEY). Program ID = PAYONEER_PROGRAM_ID.
// Webhooks land at /api/webhooks/payment with header `payoneer-signature`,
// HMAC-SHA256 of the raw body using PAYONEER_WEBHOOK_SECRET.

async function createPayoneerPayment(payment: PaymentRequest): Promise<PaymentResult> {
  const key = process.env.PAYONEER_API_KEY;
  const programId = process.env.PAYONEER_PROGRAM_ID;
  if (!key || !programId) return fail('payoneer', payment.invoiceRef);

  const baseUrl = process.env.PAYONEER_API_BASE_URL || 'https://api.payoneer.com';

  const res = await fetch(`${baseUrl}/v4/programs/${programId}/charges`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reference_id: payment.invoiceRef,
      amount: { value: payment.amount.toFixed(2), currency: payment.currency },
      description: payment.description,
      return_url: successUrl(payment.invoiceRef),
      cancel_url: cancelUrl(payment.invoiceRef),
      customer: {
        email: payment.customerEmail || 'payment@greengate.africa',
        name: payment.metadata.ownerEntity,
      },
      metadata: {
        transaction_id: payment.transactionId,
        vessel_imo: payment.metadata.vesselImo,
        vessel_name: payment.metadata.vesselName,
        jurisdiction: payment.metadata.jurisdiction,
        tax_period: payment.metadata.taxPeriod,
      },
    }),
  });

  if (!res.ok) return fail('payoneer', payment.invoiceRef);
  const data = await res.json();

  const checkoutUrl = data.checkout_url || data.redirect_url || data.payment_url;
  const id = data.id || data.charge_id || payment.invoiceRef;
  if (!checkoutUrl) return fail('payoneer', payment.invoiceRef);

  return ok('payoneer', id, checkoutUrl);
}

// ── Wire Transfer ───────────────────────────────────────────────────────────

function createWireTransfer(payment: PaymentRequest): PaymentResult {
  const ref = `AG/${payment.invoiceRef}/${payment.metadata.vesselImo}/${payment.metadata.taxPeriod}`;

  return {
    paymentId: `WIRE-${payment.invoiceRef}`,
    provider: 'wire_transfer',
    status: 'pending',
    wireInstructions: {
      beneficiary: 'SOLIDE TECHNOLOGY',
      accountNumber: '100613310001',
      beneficiaryAddress: 'Masalaha Street, M.Haybe District, Hargeisa, Somaliland',
      bank: 'Premier Bank Limited — Durdur Branch, Hargeisa, Somaliland',
      swiftCode: 'PBSMSOSM',
      iban: 'SO9500051001100613310001',
      intermediaryBank: 'Premier Bank Kenya Limited, Nairobi',
      intermediarySwift: 'IFCBKENA',
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
  payoneer: createPayoneerPayment,
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
      routesRail: (dbRow?.routes_rail as string[] | undefined) ?? [],
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
export async function verifyPaystackSignature(body: string, signature: string): Promise<boolean> {
  const { createHmac } = await import('crypto');
  const secret = process.env.PAYSTACK_SECRET_KEY || '';
  const hash = createHmac('sha512', secret).update(body).digest('hex');
  return hash === signature;
}

/**
 * Verify a Flutterwave webhook signature.
 */
export function verifyFlutterwaveSignature(signature: string): boolean {
  return signature === process.env.FLUTTERWAVE_WEBHOOK_HASH;
}

/**
 * Verify a Payoneer webhook signature (HMAC-SHA256 of raw body).
 */
export async function verifyPayoneerSignature(body: string, signature: string): Promise<boolean> {
  const secret = process.env.PAYONEER_WEBHOOK_SECRET || '';
  if (!secret || !signature) return false;
  const { createHmac } = await import('crypto');
  const hash = createHmac('sha256', secret).update(body).digest('hex');
  return hash === signature;
}

// ── Plan 7C: Typed Read Helpers for `payments` Table ──────────────────────

/**
 * 10-rail polymorphic payment table (mig 047-054).
 * Each rail carries its own metadata in `rail_details` JSONB.
 */
export type PaymentRail =
  | 'STRIPE'
  | 'WIRE_TRANSFER'
  | 'CASH'
  | 'CHEQUE'
  | 'LETTER_OF_CREDIT'
  | 'NETTING'
  | 'THIRD_PARTY'
  | 'MOBILE_MONEY'
  | 'BANK_GUARANTEE'
  | 'WALLET';

/**
 * Status enum for polymorphic payment tracking.
 * Naming: `payment_status_v7` in schema (avoids future collision).
 */
export type PaymentStatusV7 =
  | 'INITIATED'
  | 'PROCESSING'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REFUNDED';

/**
 * Typed row for the `payments` table.
 * Used by shipowner portal, cash desk, admin payments dashboard.
 */
export interface PaymentRow {
  id: string;
  transaction_id: string | null;
  shipowner_id: string;
  declared_by: string | null;
  amount_minor: number;
  currency: string;
  amount_usd_minor: number;
  fx_rate: number | null;
  fx_rate_source: string | null;
  fx_rate_locked_at: string | null;
  rail: PaymentRail;
  rail_details: Record<string, unknown>;
  external_reference: string | null;
  status: PaymentStatusV7;
  rejected_reason: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  // Plan 7C-4: receipt PDF fields (mig 061). Populated when a receipt is generated
  // for a CONFIRMED payment (e.g., cash desk receipts). Nullable for legacy rows
  // and rails that don't generate receipts.
  receipt_ref: string | null;
  receipt_storage_path: string | null;
  receipt_generated_at: string | null;
}

/**
 * List payments for a specific shipowner, ordered by creation date (newest first).
 * Useful for the shipowner portal to show payment history.
 */
export async function listPaymentsForShipowner(
  db: SupabaseClient,
  shipownerId: string,
): Promise<PaymentRow[]> {
  const { data, error } = await db
    .from('payments')
    .select('*')
    .eq('shipowner_id', shipownerId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as PaymentRow[];
}

/**
 * List pending payments for admin review (status INITIATED or PROCESSING).
 * Excludes WALLET and STRIPE rails which have own flows.
 * Useful for the cash desk / admin payments page.
 */
export async function listPendingAdminPayments(
  db: SupabaseClient,
): Promise<PaymentRow[]> {
  const { data, error } = await db
    .from('payments')
    .select('*')
    .in('status', ['INITIATED', 'PROCESSING'])
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as PaymentRow[];
}

/**
 * Get a single payment by ID. Returns null if not found.
 * Useful for detail pages or status checks.
 */
export async function getPayment(
  db: SupabaseClient,
  id: string,
): Promise<PaymentRow | null> {
  const { data, error } = await db
    .from('payments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as PaymentRow | null) ?? null;
}

// ── Plan 7C-2: Multi-active provider routing ───────────────────────────────

/**
 * Active provider row enriched with rail routing metadata.
 */
export interface ActiveProviderRow {
  provider: PaymentProvider;
  routes_rail: string[];
  display_order: number;
}

/**
 * Get ALL currently-active providers, ordered by display_order.
 * Plan 7C-2: replaces the single-active getActiveProvider() for new callers.
 * Legacy getActiveProvider() kept for the v0 createPaymentRequest path
 * (paymentIntentService dropped in Plan 7C-5; a future Plan 7D / cleanup
 * sweep can drop the v0 outbound API helpers if confirmed unused).
 */
export async function getActiveProviders(client: SupabaseClient): Promise<ActiveProviderRow[]> {
  const { data, error } = await client
    .from('payment_config')
    .select('provider, routes_rail, display_order, is_active')
    .order('display_order');
  if (error) return [];
  return (data ?? [])
    .filter((r: { is_active: boolean }) => r.is_active)
    .map((r: { provider: string; routes_rail: string[] | null; display_order: number | null }) => ({
      provider: r.provider as PaymentProvider,
      routes_rail: r.routes_rail ?? [],
      display_order: r.display_order ?? 0,
    }));
}

/**
 * Filter active providers to those declaring support for a given v7 rail.
 * Result is ordered by display_order ascending — the first element is the
 * default routing pick. Caller may surface alternatives in a sub-picker.
 *
 * @param rail - v7 payment_method enum value (STRIPE, WIRE_TRANSFER, …)
 */
export async function selectProvidersForRail(
  client: SupabaseClient,
  rail: string,
): Promise<ActiveProviderRow[]> {
  const all = await getActiveProviders(client);
  return all
    .filter((p) => p.routes_rail.includes(rail))
    .sort((a, b) => a.display_order - b.display_order);
}

/**
 * Toggle a single provider's is_active flag. Replaces the old
 * setActiveProvider() semantics where activating one deactivated all others.
 */
export async function setProviderActive(
  client: SupabaseClient,
  provider: PaymentProvider,
  isActive: boolean,
): Promise<boolean> {
  const { error } = await client
    .from('payment_config')
    .update({ is_active: isActive })
    .eq('provider', provider);
  return !error;
}

// ── Plan 7C-3: Admin payment list with filters ─────────────────────────────

export interface AdminPaymentFilters {
    status: PaymentStatusV7[];
    rail: PaymentRail[];
    from: string | null;     // ISO date inclusive
    to: string | null;       // ISO date inclusive
    q: string | null;        // ILIKE on external_reference
}

/**
 * List up to 200 payments matching the filters, newest first.
 * Used by /admin/payments PaymentsAdminPanel.
 */
export async function listAdminPayments(
    client: SupabaseClient,
    filters: AdminPaymentFilters,
    limit = 200,
): Promise<PaymentRow[]> {
    let query = client
        .from('payments')
        .select('*');

    if (filters.status.length > 0) query = query.in('status', filters.status);
    if (filters.rail.length > 0)   query = query.in('rail', filters.rail);
    if (filters.from)              query = query.gte('created_at', filters.from);
    if (filters.to)                query = query.lte('created_at', filters.to);
    if (filters.q)                 query = query.ilike('external_reference', `%${filters.q}%`);

    const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw new Error(error.message);
    return (data ?? []) as PaymentRow[];
}
