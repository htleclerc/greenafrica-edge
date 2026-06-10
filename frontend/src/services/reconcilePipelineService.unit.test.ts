import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Stub PDF + email — the reconcile unit test is hermetic.
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

import { runReconcilePipeline } from './reconcilePipelineService';

const SOMALILAND_JID = '00000000-0000-4000-8000-00000000534f';

// Go response for both tax/calculate calls (distance-final is separate).
const TAX_RESULT = {
  tco2: 14.2,
  usd_amount: 568.0,
  breakdown: {
    distance_nm: 155,
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
  id: 'vessel-r-001',
  name: 'MV RECON',
  imo_number: 'TEST-RECON',
  mmsi: '999810001',
  category: 'CARGO',
  gross_tonnage_dwt: 30000,
  shipowner_id: 'owner-r-001',
};

const AGENT = { id: 'agent-r-001', email: 'agent@recon.test', full_name: 'Recon Agent' };

const PROFORMA_CREATED_AT = '2026-06-05T08:30:00.000Z';
const PROFORMA_AS_OF = '2026-06-05'; // UTC date slice of PROFORMA_CREATED_AT

/**
 * Fake SupabaseClient for the reconcile pipeline. Captures the transactions insert
 * payload so the test can assert the Wedge 2 jurisdiction/tariff/as_of contract.
 */
function makeClient(opts: { proformaUsd?: number; proformaCreatedAt?: string } = {}) {
  const captured: {
    insertedTxn?: Record<string, unknown>;
    alertUpdate?: Record<string, unknown>;
  } = {};

  const proformaUsd = opts.proformaUsd ?? 532.0;

  const alertRow = {
    id: 'alert-recon-1',
    vessel_id: VESSEL.id,
    imo_number: 'TEST-RECON',
    status: 'DEPARTED_EEZ',
    proforma_transaction_id: 'proforma-txn-001',
    matched_agent_id: AGENT.id,
    jurisdiction_id: SOMALILAND_JID,
    vessel: VESSEL,
  };

  const proformaRow = {
    id: 'proforma-txn-001',
    tax_amount_usd: proformaUsd,
    document_type: 'PROFORMA',
    created_at: opts.proformaCreatedAt ?? PROFORMA_CREATED_AT,
  };

  const distanceFinalPayload = {
    alert_id: 'alert-recon-1',
    total_distance_eez_nm: 155,
  };

  let fetchCallCount = 0;
  const fetchMock = vi.fn(() => {
    fetchCallCount += 1;
    if (fetchCallCount === 1) {
      // First call: distance-final
      return Promise.resolve({
        ok: true,
        json: async () => distanceFinalPayload,
        text: async () => '',
      });
    }
    // Second call: tax/calculate
    return Promise.resolve({
      ok: true,
      json: async () => TAX_RESULT,
      text: async () => '',
    });
  });

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
    if (table === 'transactions') {
      return {
        select: vi.fn((cols: string) => {
          // proforma SELECT vs reconcile result SELECT differ — both resolve proforma data
          void cols;
          return {
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: proformaRow, error: null }),
            })),
          };
        }),
        insert: vi.fn((payload: Record<string, unknown>) => {
          captured.insertedTxn = payload;
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'recon-txn-001', ref: 'INV-2026-000099' },
                error: null,
              }),
            })),
          };
        }),
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
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
    if (table === 'app_config') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
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
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    client: { from } as unknown as SupabaseClient,
    captured,
    fetchMock,
  };
}

describe('runReconcilePipeline — Wedge 2 (jurisdiction + tariff_id + as_of pinning)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('tax/calculate call includes jurisdiction_id + as_of pinned to proforma issuance date', async () => {
    const { client, fetchMock } = makeClient();
    vi.stubGlobal('fetch', fetchMock);

    const result = await runReconcilePipeline({
      alertId: 'alert-recon-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      taxApiSecret: 'secret-recon',
      toleranceOverride: 10,
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`pipeline failed: ${result.reason}`);

    // Two fetch calls: distance-final then tax/calculate
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calcCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const [calcUrl, calcInit] = calcCall;
    expect(calcUrl).toContain('/api/v1/tax/calculate');
    const body = JSON.parse(calcInit.body as string);

    // jurisdiction_id forwarded from the alert
    expect(body).toMatchObject({
      jurisdiction_id: SOMALILAND_JID,
    });

    // as_of is the UTC date of the proforma's created_at (D3 issuance-date rule)
    expect(body.as_of).toBe(PROFORMA_AS_OF);
  });

  it('inserted reconciliation transaction carries tariff_id and jurisdiction_id', async () => {
    const { client, captured, fetchMock } = makeClient();
    vi.stubGlobal('fetch', fetchMock);

    const result = await runReconcilePipeline({
      alertId: 'alert-recon-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      toleranceOverride: 10,
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`pipeline failed: ${result.reason}`);

    expect(captured.insertedTxn).toMatchObject({
      vessel_id: VESSEL.id,
      related_transaction_id: 'proforma-txn-001',
      tariff_id: 'tariff-so-sea-001',
      jurisdiction_id: SOMALILAND_JID,
    });
  });

  it('fail-closed: Go returns 422 no_active_tariff → ok:false, reason contains 422, no transaction inserted', async () => {
    let fetchCallCount = 0;
    const fetchMock = vi.fn(() => {
      fetchCallCount += 1;
      if (fetchCallCount === 1) {
        // First call: distance-final succeeds
        return Promise.resolve({
          ok: true,
          json: async () => ({ alert_id: 'alert-recon-1', total_distance_eez_nm: 155 }),
          text: async () => '',
        });
      }
      // Second call: tax/calculate → 422 no_active_tariff
      return Promise.resolve({
        ok: false,
        status: 422,
        json: async () => ({ error: 'no_active_tariff' }),
        text: async () => '{"error":"no_active_tariff"}',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured } = makeClient();
    const result = await runReconcilePipeline({
      alertId: 'alert-recon-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      toleranceOverride: 10,
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('422');
    expect(captured.insertedTxn).toBeUndefined();
  });

  it('proformaAsOf uses UTC slice — offset created_at 2026-06-05T01:30:00+03:00 → as_of 2026-06-04', async () => {
    // 2026-06-05T01:30:00+03:00 = 2026-06-04T22:30:00Z → UTC date is 2026-06-04.
    const { client, fetchMock } = makeClient({ proformaCreatedAt: '2026-06-05T01:30:00+03:00' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runReconcilePipeline({
      alertId: 'alert-recon-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      toleranceOverride: 10,
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`pipeline failed: ${result.reason}`);

    const calcCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(calcCall[1].body as string);
    expect(body.as_of).toBe('2026-06-04');
  });
});
