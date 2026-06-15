import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Keep the real hash/sign/verify helpers (pure, deterministic) but stub the PDF
// renderer so this unit test is hermetic and fast (no font/runtime dependency).
vi.mock('./invoiceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./invoiceService')>();
  return {
    ...actual,
    generateInvoicePdf: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])), // "%PDF"
  };
});

vi.mock('./emailService', () => ({
  sendInvoiceEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { runProformaPipeline } from './proformaPipelineService';

const SOMALILAND_JID = '00000000-0000-4000-8000-00000000534f';

// Maritime tax result. Wedge 2: breakdown carries tariff_id, jurisdiction_id, currency.
const MARITIME_TAX_RESULT = {
  tco2: 13.3,
  usd_amount: 532.0,
  breakdown: {
    distance_nm: 140,
    emissions_factor_g_co2_per_nm: 95000,
    emissions_factor_source: 'IMO_CUBIC_LAW',
    emissions_factor_id: 'ef-cargo-30k',
    rate_usd_per_tco2: 40,
    tariff_id: 'tariff-so-sea-001',
    jurisdiction_id: SOMALILAND_JID,
    currency: 'USD',
  },
};

const VESSEL = {
  id: 'vessel-001',
  name: 'MV PIPE',
  imo_number: 'TEST-PIPE',
  mmsi: '999700001',
  category: 'CARGO',
  gross_tonnage_dwt: 30000,
  shipowner_id: 'owner-001',
};

const AGENT = { id: 'agent-001', email: 'agent@test.com', full_name: 'Test Agent' };

/**
 * Fake SupabaseClient for the maritime branch. Captures the transactions insert
 * payload so the test can assert the Wedge 2 jurisdiction/tariff contract.
 */
function makeClient(opts: { alertStatus?: string; arrivedAt?: string | null } = {}) {
  const captured: {
    insertedTxn?: Record<string, unknown>;
    alertUpdate?: Record<string, unknown>;
  } = {};

  const alertRow = {
    id: 'alert-sea-1',
    mode: 'SEA',
    vessel_id: VESSEL.id,
    aircraft_id: null,
    imo_number: 'TEST-PIPE',
    estimated_route_nm: 140,
    matched_agent_id: AGENT.id,
    status: opts.alertStatus ?? 'MATCHED_AUTO',
    jurisdiction_id: SOMALILAND_JID,
    arrived_at: opts.arrivedAt ?? null,
    vessel: VESSEL,
    aircraft: null,
  };

  const from = vi.fn((table: string) => {
    if (table === 'arrival_alerts') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: alertRow, error: null }),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          captured.alertUpdate = payload;
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
      };
    }
    if (table === 'jurisdictions') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { name: 'Republic of Somaliland' },
              error: null,
            }),
          })),
        })),
      };
    }
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: AGENT, error: null }),
          })),
        })),
      };
    }
    if (table === 'shipowners') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Owner Corp' }, error: null }),
          })),
        })),
      };
    }
    if (table === 'transactions') {
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          captured.insertedTxn = payload;
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'a1b2c3d4-aaaa-bbbb-cccc-000000000099', ref: 'INV-2026-000099' },
                error: null,
              }),
            })),
          };
        }),
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    client: { from } as unknown as SupabaseClient,
    captured,
    from,
  };
}

describe('runProformaPipeline — maritime branch (Wedge 2 jurisdiction + tariff_id)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('maritime alert → POSTs jurisdiction_id to Go calc → inserts transaction with tariff_id and jurisdiction_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MARITIME_TAX_RESULT,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured } = makeClient();
    const result = await runProformaPipeline({
      alertId: 'alert-sea-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      taxApiSecret: 'secret-abc',
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.transactionId).toBe('a1b2c3d4-aaaa-bbbb-cccc-000000000099');

    // ── jurisdiction_id is forwarded to the Go calculate call ──────────────
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('http://tax.test/api/v1/tax/calculate');
    const body = JSON.parse((calledInit as RequestInit).body as string);
    expect(body).toMatchObject({
      imo: 'TEST-PIPE',
      category: 'CARGO',
      gross_tonnage: 30000,
      distance_nm: 140,
      jurisdiction_id: SOMALILAND_JID,
    });

    // ── The inserted PROFORMA transaction carries tariff_id + jurisdiction_id ─
    expect(captured.insertedTxn).toMatchObject({
      vessel_id: VESSEL.id,
      vessel_name: 'MV PIPE',
      vessel_imo: 'TEST-PIPE',
      document_type: 'PROFORMA',
      emissions_tco2: 13.3,
      tax_amount_usd: 532.0,
      arrival_alert_id: 'alert-sea-1',
      rate_usd_per_tco2: 40,
      // Wedge 2 snapshot fields:
      tariff_id: 'tariff-so-sea-001',
      jurisdiction_id: SOMALILAND_JID,
    });

    // ── Alert flipped to PROFORMA_SENT ────────────────────────────────────
    expect(captured.alertUpdate).toMatchObject({
      status: 'PROFORMA_SENT',
      proforma_transaction_id: 'a1b2c3d4-aaaa-bbbb-cccc-000000000099',
    });
  });

  it('fail-closed: 422 no_active_tariff → ok:false, no transaction inserted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'no_active_tariff' }),
      text: async () => '{"error":"no_active_tariff"}',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured, from } = makeClient();
    const result = await runProformaPipeline({
      alertId: 'alert-sea-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('422');
    expect(captured.insertedTxn).toBeUndefined();
    expect(from).not.toHaveBeenCalledWith('transactions');
  });
});

describe('runProformaPipeline — corridor guard (W4-T6 provisional stamp + reissue)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function stubTaxFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MARITIME_TAX_RESULT,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('pre-arrival issuance (arrived_at null) → breakdown_json.jurisdiction_provisional = true in the INSERT payload', async () => {
    stubTaxFetch();
    const { client, captured } = makeClient({ arrivedAt: null });

    const result = await runProformaPipeline({
      alertId: 'alert-sea-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    const breakdown = captured.insertedTxn?.breakdown_json as Record<string, unknown>;
    expect(breakdown).toMatchObject({
      ...MARITIME_TAX_RESULT.breakdown,
      jurisdiction_provisional: true,
    });
    expect(breakdown.jurisdiction_reissued_from).toBeUndefined();
  });

  it('post-arrival issuance (arrived_at set) → no jurisdiction_provisional stamp', async () => {
    stubTaxFetch();
    const { client, captured } = makeClient({ arrivedAt: '2026-06-10T08:00:00.000Z' });

    const result = await runProformaPipeline({
      alertId: 'alert-sea-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    expect(captured.insertedTxn?.breakdown_json).toEqual(MARITIME_TAX_RESULT.breakdown);
  });

  it('reissue mode on a DEPARTED_EEZ alert → stamps jurisdiction_reissued_from, never provisional, alert keeps its status', async () => {
    stubTaxFetch();
    const { client, captured } = makeClient({
      alertStatus: 'DEPARTED_EEZ',
      arrivedAt: '2026-06-10T08:00:00.000Z',
    });

    const result = await runProformaPipeline({
      alertId: 'alert-sea-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      dryRunEmail: true,
      dryRunStorage: true,
      reissue: { fromTransactionId: 'voided-proforma-001' },
    });

    expect(result.ok).toBe(true);
    const breakdown = captured.insertedTxn?.breakdown_json as Record<string, unknown>;
    expect(breakdown.jurisdiction_reissued_from).toBe('voided-proforma-001');
    expect(breakdown.jurisdiction_provisional).toBeUndefined();

    // Only the pointer is re-pointed — NO status flip (the alert must stay
    // DEPARTED_EEZ so the queued reconcile re-runs against the new proforma).
    expect(captured.alertUpdate).toEqual({
      proforma_transaction_id: 'a1b2c3d4-aaaa-bbbb-cccc-000000000099',
    });
  });

  it('reissue mode rejects an alert that is not DEPARTED_EEZ', async () => {
    stubTaxFetch();
    const { client, captured } = makeClient({ alertStatus: 'MATCHED_AUTO' });

    const result = await runProformaPipeline({
      alertId: 'alert-sea-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      dryRunEmail: true,
      dryRunStorage: true,
      reissue: { fromTransactionId: 'voided-proforma-001' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('not DEPARTED_EEZ');
    expect(captured.insertedTxn).toBeUndefined();
  });
});
