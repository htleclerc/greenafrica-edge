import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Fake supabase admin client — captures calls + returns scriptable rows.
// auditService and system-actor are NOT mocked: audit inserts go through the
// real writeAuditLog so the payload shape is asserted against the real table.
// ─────────────────────────────────────────────────────────────────────────────

// Mirror of public.audit_action (mig 003, extended by mig 016) and
// public.audit_severity (mig 003). An insert with any other value fails at
// the DB level — which is exactly the bug this suite locks down.
const AUDIT_ACTIONS = [
  'LOGIN', 'LOGOUT', 'VESSEL_VIEWED', 'INVOICE_GENERATED',
  'TAX_RATE_UPDATED', 'EXEMPTION_GRANTED', 'REPORT_EXPORTED',
  'USER_CREATED', 'TRANSACTION_UPDATED', 'INVOICE_SENT',
];
const AUDIT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'];

const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

let transactionRows: Record<string, unknown>[] = [];
let systemActorRow: Record<string, unknown> | null = null;
// Existing CONFIRMED payments row for idempotency tests
let existingConfirmedPayment: Record<string, unknown> | null = null;
// Scriptable payments insert error for insert-failure test
let paymentsInsertError: { message: string } | null = null;
// Scriptable RPC error for recompute-failure test
let recomputeRpcError: { message: string } | null = null;

// m3 — pin the eq column for the transactions lookup
const eqCalls: { col: string; val: string }[] = [];

function resetMocks() {
  insertCalls.length = 0;
  rpcCalls.length = 0;
  eqCalls.length = 0;
  existingConfirmedPayment = null;
  paymentsInsertError = null;
  recomputeRpcError = null;
  transactionRows = [{
    id: 'abcd1234-0000-0000-0000-000000000000',
    vessel_id: 'v-1',
    vessel_name: 'MV Test',
    tax_amount_usd: 1250,
    status: 'PENDING',
    shipowner_id: 'so-1',
    jurisdiction_id: 'jur-djibouti',
  }];
  systemActorRow = { id: 'sys-admin-1' };
}

// Build a fluent Supabase query builder stub
const fromBuilder = (table: string) => {
  if (table === 'transactions') {
    return {
      select: () => ({
        // m3 — capture the eq column/value so tests can assert lookup column
        eq: (col: string, val: string) => {
          eqCalls.push({ col, val });
          return {
            limit: async () => ({ data: transactionRows, error: null }),
          };
        },
      }),
    };
  }
  if (table === 'payments') {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: existingConfirmedPayment, error: null }),
          }),
        }),
      }),
      insert: (payload: Record<string, unknown>) => {
        insertCalls.push({ table, payload });
        return Promise.resolve({ data: null, error: paymentsInsertError });
      },
    };
  }
  if (table === 'profiles') {
    // resolveSystemActor: select().eq().in().order().limit().maybeSingle()
    return {
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: systemActorRow, error: null }),
              }),
            }),
          }),
        }),
      }),
    };
  }
  if (table === 'audit_logs') {
    return {
      insert: (payload: Record<string, unknown>) => {
        insertCalls.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }
  return {} as unknown as Record<string, unknown>;
};

const mockSupabase = {
  from: vi.fn(fromBuilder),
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return { data: null, error: recomputeRpcError };
  }),
};

vi.mock('@/lib/supabase/tenant', () => ({
  createPlatformClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/services/paymentService', () => ({
  // confirmPayment is no longer imported by the new route; kept here so any
  // accidental import would be captured (test would detect the call).
  confirmPayment: vi.fn().mockResolvedValue(true),
  verifyPaystackSignature: vi.fn().mockResolvedValue(true),
  verifyFlutterwaveSignature: vi.fn().mockReturnValue(true),
  verifyPayoneerSignature: vi.fn().mockResolvedValue(true),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('http://x/api/webhooks/payment', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  }) as unknown as NextRequest;
}

function buildRawReq(rawBody: string, headers: Record<string, string> = {}): NextRequest {
  return new Request('http://x/api/webhooks/payment', {
    method: 'POST',
    body: rawBody,
    headers,
  }) as unknown as NextRequest;
}

// Provider-canonical success payloads. Invoice ref == transactions.invoice_ref.
const INVOICE_REF = 'INV-2026-ABCD1234';
const PROVIDER_REF_PAYSTACK = '12345';
const PROVIDER_REF_FLW = '67890';
const PROVIDER_REF_WAVE = 'wave-sess-001';
const PROVIDER_REF_PAYONEER = 'po-charge-001';

const paystackSuccess = {
  event: 'charge.success',
  data: { reference: INVOICE_REF, id: Number(PROVIDER_REF_PAYSTACK), amount: 125000, currency: 'USD' },
};
const flutterwaveSuccess = {
  event: 'charge.completed',
  data: { tx_ref: INVOICE_REF, id: Number(PROVIDER_REF_FLW), amount: 1250, currency: 'USD', status: 'successful' },
};
const waveSuccess = {
  payment_status: 'succeeded',
  client_reference: INVOICE_REF,
  id: PROVIDER_REF_WAVE,
  amount: 1250,
  currency: 'USD',
};
const payoneerSuccess = {
  event_type: 'charge.succeeded',
  reference_id: INVOICE_REF,
  id: PROVIDER_REF_PAYONEER,
  amount: { value: '1250.00', currency: 'USD' },
};

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetMocks();
  vi.clearAllMocks();
  // Reset the module cache so each test gets a fresh route module
  vi.resetModules();
});

// ── Original audit-trail tests (preserved, adjusted for new route shape) ─────

describe('POST /api/webhooks/payment — audit trail', () => {
  it('writes an audit log with valid enum values on Paystack success', async () => {
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('confirmed');

    // The new route no longer calls confirmPayment (legacy direct flip)
    const { confirmPayment } = await import('@/services/paymentService');
    expect(confirmPayment).not.toHaveBeenCalled();

    const audit = insertCalls.find((c) => c.table === 'audit_logs');
    expect(audit).toBeDefined();
    const payload = audit!.payload;

    expect(AUDIT_ACTIONS).toContain(payload.action);
    expect(AUDIT_SEVERITIES).toContain(payload.severity);
    expect(payload.action).toBe('TRANSACTION_UPDATED');
    expect(payload.severity).toBe('INFO');

    expect(payload).not.toHaveProperty('details');
    expect(payload.details_json).toMatchObject({
      event: 'PAYMENT_RECEIVED',
      provider: 'paystack',
      provider_ref: PROVIDER_REF_PAYSTACK,
      amount_usd: 1250,
      vessel: 'MV Test',
    });

    expect(payload.user_id).toBe('sys-admin-1');
    expect(payload.user_id).not.toBe('00000000-0000-0000-0000-000000000000');
    expect(typeof payload.user_full_name).toBe('string');
    expect((payload.user_full_name as string).length).toBeGreaterThan(0);
  });

  it('skips the audit write (fail-soft) when no system actor exists', async () => {
    systemActorRow = null;
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));

    expect(res.status).toBe(200);
    // No system actor → can't insert payments row (confirmed_by NOT NULL) → error_logged
    expect(insertCalls.find((c) => c.table === 'audit_logs')).toBeUndefined();
    expect(insertCalls.find((c) => c.table === 'payments')).toBeUndefined();
  });

  it('does not confirm or audit on a non-success event', async () => {
    const { POST } = await import('./route');
    const res = await POST(buildReq(
      { event: 'charge.failed', data: { reference: INVOICE_REF, id: 12345 } },
      { 'x-paystack-signature': 'sig' },
    ));

    expect(res.status).toBe(200);
    const { confirmPayment } = await import('@/services/paymentService');
    expect(confirmPayment).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it('returns unknown_reference when no transaction matches', async () => {
    transactionRows = [];
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('unknown_reference');
    expect(insertCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });
});

// ── m3 — pin the lookup column ────────────────────────────────────────────────

describe('POST /api/webhooks/payment — reference lookup column', () => {
  it('looks up transactions by invoice_ref column with the exact ref value', async () => {
    const { POST } = await import('./route');
    await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));

    // The eq call for transactions must use 'invoice_ref' as the column
    const txEq = eqCalls.find((c) => c.col === 'invoice_ref');
    expect(txEq).toBeDefined();
    expect(txEq!.col).toBe('invoice_ref');
    expect(txEq!.val).toBe(INVOICE_REF);
  });
});

// ── Payments-row rail: happy path per provider ────────────────────────────────

describe('POST /api/webhooks/payment — payments-row rail (happy path)', () => {
  it.each([
    ['paystack', paystackSuccess, { 'x-paystack-signature': 'sig' }, PROVIDER_REF_PAYSTACK, 'MOBILE_MONEY'],
    ['flutterwave', flutterwaveSuccess, { 'verif-hash': 'hash' }, PROVIDER_REF_FLW, 'MOBILE_MONEY'],
    ['payoneer', payoneerSuccess, { 'payoneer-signature': 'posig' }, PROVIDER_REF_PAYONEER, 'THIRD_PARTY'],
  ] as const)('inserts CONFIRMED payment row for %s', async (providerName, payload, headers, expectedProviderRef, expectedRail) => {
    const { POST } = await import('./route');
    const res = await POST(buildReq(payload, headers));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('confirmed');

    // payments INSERT happened
    const paymentInsert = insertCalls.find((c) => c.table === 'payments');
    expect(paymentInsert).toBeDefined();
    const row = paymentInsert!.payload;

    expect(row.transaction_id).toBe('abcd1234-0000-0000-0000-000000000000');
    expect(row.shipowner_id).toBe('so-1');
    // I1 — jurisdiction_id stamped from the transaction row
    expect(row.jurisdiction_id).toBe('jur-djibouti');
    expect(row.status).toBe('CONFIRMED');
    expect(row.rail).toBe(expectedRail);
    expect(row.amount_usd_minor).toBe(125000); // $1250 * 100
    expect(row.currency).toBe('USD');
    // I2 — external_reference is namespaced as "{provider}:{providerRef}"
    expect(row.external_reference).toBe(`${providerName}:${expectedProviderRef}`);
    expect(row.confirmed_by).toBe('sys-admin-1');
    expect(row.confirmed_at).toBeTruthy();
    expect((row.rail_details as Record<string, unknown>).provider).toBe(providerName);

    // recompute RPC called
    const rpc = rpcCalls.find((c) => c.fn === 'recompute_transaction_status');
    expect(rpc).toBeDefined();
    expect(rpc!.args.p_txn_id).toBe('abcd1234-0000-0000-0000-000000000000');
  });
});

// ── m1 — Wave explicitly disabled ────────────────────────────────────────────

describe('POST /api/webhooks/payment — Wave not supported', () => {
  it('verifies the Wave signature then returns wave_not_supported (no DB writes)', async () => {
    process.env.WAVE_WEBHOOK_SECRET = 'waveSecret';
    const { POST } = await import('./route');
    const res = await POST(buildReq(waveSuccess, { 'x-wave-signature': 'waveSecret' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('wave_not_supported');
    expect(json.received).toBe(true);
    // No DB writes — wave is disabled before any data access
    expect(insertCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);

    delete process.env.WAVE_WEBHOOK_SECRET;
  });

  it('still returns 401 for an invalid Wave secret', async () => {
    process.env.WAVE_WEBHOOK_SECRET = 'correct-secret';
    const { POST } = await import('./route');
    const res = await POST(buildReq(waveSuccess, { 'x-wave-signature': 'wrong-secret' }));
    expect(res.status).toBe(401);
    delete process.env.WAVE_WEBHOOK_SECRET;
  });
});

// ── m2 — JSON parse failure → 400 ────────────────────────────────────────────

describe('POST /api/webhooks/payment — JSON parse failure', () => {
  it('returns 400 (not 200 error_logged) for malformed JSON', async () => {
    const { POST } = await import('./route');
    const res = await POST(buildRawReq('not valid json', { 'x-paystack-signature': 'sig' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
    // No DB writes
    expect(insertCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });
});

// ── Amount mismatch ───────────────────────────────────────────────────────────

describe('POST /api/webhooks/payment — amount mismatch', () => {
  it('rejects when Paystack sends $1 instead of $1250', async () => {
    const mismatchPayload = {
      event: 'charge.success',
      data: { reference: INVOICE_REF, id: 12345, amount: 100 /* $1 in cents */, currency: 'USD' },
    };
    const { POST } = await import('./route');
    const res = await POST(buildReq(mismatchPayload, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('rejected_amount_mismatch');
    // No payments insert
    expect(insertCalls.find((c) => c.table === 'payments')).toBeUndefined();
    // No recompute
    expect(rpcCalls).toHaveLength(0);
    // Audit with mismatch event
    const audit = insertCalls.find((c) => c.table === 'audit_logs');
    expect(audit).toBeDefined();
    expect((audit!.payload.details_json as Record<string, unknown>).event).toBe('PAYMENT_AMOUNT_MISMATCH');
  });

  it('rejects when Flutterwave sends $1 instead of $1250', async () => {
    const mismatchPayload = {
      event: 'charge.completed',
      data: { tx_ref: INVOICE_REF, id: 67890, amount: 1 /* already major unit */, currency: 'USD', status: 'successful' },
    };
    const { POST } = await import('./route');
    const res = await POST(buildReq(mismatchPayload, { 'verif-hash': 'hash' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('rejected_amount_mismatch');
    expect(insertCalls.find((c) => c.table === 'payments')).toBeUndefined();
    expect(rpcCalls).toHaveLength(0);
  });

  it('rejects non-USD currency (no FX guessing on fiscal payment)', async () => {
    const nonUsdPayload = {
      event: 'charge.success',
      data: { reference: INVOICE_REF, id: 12345, amount: 125000, currency: 'NGN' },
    };
    const { POST } = await import('./route');
    const res = await POST(buildReq(nonUsdPayload, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('rejected_amount_mismatch');
    expect(insertCalls.find((c) => c.table === 'payments')).toBeUndefined();
    expect(rpcCalls).toHaveLength(0);
    const audit = insertCalls.find((c) => c.table === 'audit_logs');
    expect(audit).toBeDefined();
    const details = audit!.payload.details_json as Record<string, unknown>;
    expect(details.event).toBe('PAYMENT_AMOUNT_MISMATCH');
    expect(details.paid_currency).toBe('NGN');
  });

  it('rejects non-USD currency for Payoneer', async () => {
    const nonUsdPayload = {
      event_type: 'charge.succeeded',
      reference_id: INVOICE_REF,
      id: PROVIDER_REF_PAYONEER,
      amount: { value: '1250.00', currency: 'EUR' },
    };
    const { POST } = await import('./route');
    const res = await POST(buildReq(nonUsdPayload, { 'payoneer-signature': 'posig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('rejected_amount_mismatch');
    expect(insertCalls.find((c) => c.table === 'payments')).toBeUndefined();
  });

  // m3 — amount boundary pair: ±$0.01 passes, ±$0.02 rejects
  it('accepts amount exactly at the +$0.01 tolerance boundary (Paystack)', async () => {
    // $1250 + $0.01 = $1250.01 → 125001 cents
    const payload = {
      event: 'charge.success',
      data: { reference: INVOICE_REF, id: 12345, amount: 125001, currency: 'USD' },
    };
    const { POST } = await import('./route');
    const res = await POST(buildReq(payload, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.action).toBe('confirmed');
  });

  it('accepts amount exactly at the -$0.01 tolerance boundary (Paystack)', async () => {
    // $1250 - $0.01 = $1249.99 → 124999 cents
    const payload = {
      event: 'charge.success',
      data: { reference: INVOICE_REF, id: 12345, amount: 124999, currency: 'USD' },
    };
    const { POST } = await import('./route');
    const res = await POST(buildReq(payload, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.action).toBe('confirmed');
  });

  it('rejects amount $0.02 over tolerance (Paystack)', async () => {
    // $1250 + $0.02 = $1250.02 → 125002 cents
    const payload = {
      event: 'charge.success',
      data: { reference: INVOICE_REF, id: 12345, amount: 125002, currency: 'USD' },
    };
    const { POST } = await import('./route');
    const res = await POST(buildReq(payload, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.action).toBe('rejected_amount_mismatch');
  });

  it('rejects amount $0.02 under tolerance (Paystack)', async () => {
    // $1250 - $0.02 = $1249.98 → 124998 cents
    const payload = {
      event: 'charge.success',
      data: { reference: INVOICE_REF, id: 12345, amount: 124998, currency: 'USD' },
    };
    const { POST } = await import('./route');
    const res = await POST(buildReq(payload, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.action).toBe('rejected_amount_mismatch');
  });
});

// ── Unknown reference ─────────────────────────────────────────────────────────

describe('POST /api/webhooks/payment — unknown reference', () => {
  it('returns unknown_reference with zero writes for all non-wave providers', async () => {
    transactionRows = [];
    const { POST } = await import('./route');

    for (const [body, headers] of [
      [paystackSuccess, { 'x-paystack-signature': 'sig' }],
      [flutterwaveSuccess, { 'verif-hash': 'hash' }],
      [payoneerSuccess, { 'payoneer-signature': 'posig' }],
    ] as Array<[unknown, Record<string, string>]>) {
      insertCalls.length = 0;
      rpcCalls.length = 0;
      const res = await POST(buildReq(body, headers));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.action).toBe('unknown_reference');
      expect(insertCalls).toHaveLength(0);
      expect(rpcCalls).toHaveLength(0);
    }
  });
});

// ── Already PAID idempotency ──────────────────────────────────────────────────

describe('POST /api/webhooks/payment — idempotency', () => {
  it('returns already_paid when transaction status is PAID', async () => {
    transactionRows = [{
      id: 'abcd1234-0000-0000-0000-000000000000',
      vessel_id: 'v-1',
      vessel_name: 'MV Test',
      tax_amount_usd: 1250,
      status: 'PAID',
      shipowner_id: 'so-1',
      jurisdiction_id: 'jur-djibouti',
    }];
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('already_paid');
    expect(insertCalls.find((c) => c.table === 'payments')).toBeUndefined();
    expect(rpcCalls).toHaveLength(0);
  });

  it('returns already_paid when a CONFIRMED payments row exists for the namespaced providerRef', async () => {
    // I2 — idempotency lookup uses the namespaced ref "paystack:{id}"
    existingConfirmedPayment = { id: 'pay-existing-1', status: 'CONFIRMED' };
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('already_paid');
    expect(insertCalls.find((c) => c.table === 'payments')).toBeUndefined();
    expect(rpcCalls).toHaveLength(0);
  });
});

// ── I3 — NULL shipowner guard ─────────────────────────────────────────────────

describe('POST /api/webhooks/payment — null shipowner', () => {
  it('returns error_logged (defensive) when matched tx has no shipowner_id', async () => {
    transactionRows = [{
      id: 'abcd1234-0000-0000-0000-000000000000',
      vessel_id: 'v-1',
      vessel_name: 'MV Test',
      tax_amount_usd: 1250,
      status: 'PENDING',
      shipowner_id: null,
      jurisdiction_id: 'jur-djibouti',
    }];
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('error_logged');
    expect(insertCalls.find((c) => c.table === 'payments')).toBeUndefined();
    expect(rpcCalls).toHaveLength(0);
  });
});

// ── m3 — insert failure → error_logged ───────────────────────────────────────

describe('POST /api/webhooks/payment — payments insert failure', () => {
  it('returns error_logged when the payments INSERT fails', async () => {
    paymentsInsertError = { message: 'unique violation' };
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('error_logged');
    // RPC must NOT have been called (insert failed → bail before recompute)
    expect(rpcCalls).toHaveLength(0);
  });
});

// ── m3 — recompute failure → still confirmed ──────────────────────────────────

describe('POST /api/webhooks/payment — recompute failure', () => {
  it('returns confirmed even when the recompute RPC errors (payment row already inserted)', async () => {
    recomputeRpcError = { message: 'rpc error' };
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Payment row is inserted and CONFIRMED — recompute failure is logged but
    // the payment is not rolled back.
    expect(json.action).toBe('confirmed');
    expect(insertCalls.find((c) => c.table === 'payments')).toBeDefined();
  });
});

// ── Signature failures ────────────────────────────────────────────────────────

describe('POST /api/webhooks/payment — signature validation', () => {
  it('returns 401 for invalid Paystack signature', async () => {
    const { verifyPaystackSignature } = await import('@/services/paymentService');
    vi.mocked(verifyPaystackSignature).mockResolvedValueOnce(false);
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'bad-sig' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid Flutterwave hash', async () => {
    const { verifyFlutterwaveSignature } = await import('@/services/paymentService');
    vi.mocked(verifyFlutterwaveSignature).mockReturnValueOnce(false);
    const { POST } = await import('./route');
    const res = await POST(buildReq(flutterwaveSuccess, { 'verif-hash': 'bad-hash' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid Payoneer signature', async () => {
    const { verifyPayoneerSignature } = await import('@/services/paymentService');
    vi.mocked(verifyPayoneerSignature).mockResolvedValueOnce(false);
    const { POST } = await import('./route');
    const res = await POST(buildReq(payoneerSuccess, { 'payoneer-signature': 'bad-sig' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for unknown provider (no recognised header)', async () => {
    const { POST } = await import('./route');
    const res = await POST(buildReq(paystackSuccess, {}));
    expect(res.status).toBe(400);
  });
});
