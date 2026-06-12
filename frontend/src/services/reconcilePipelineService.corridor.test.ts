import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Stub PDF + email — the corridor unit test is hermetic.
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

// Capture structured log events (scopedLogger) — the corridor guard's warn/error
// events are part of its contract (settlement ops alert on them).
const logCalls = vi.hoisted(
  () => [] as { level: string; event: string; ctx?: Record<string, unknown> }[],
);
vi.mock('@/lib/logger', () => {
  const push =
    (level: string) =>
    (event: string, ctx?: Record<string, unknown>) => {
      logCalls.push({ level, event, ctx });
    };
  return {
    log: (level: string, _scope: string, event: string, ctx?: Record<string, unknown>) => {
      logCalls.push({ level, event, ctx });
    },
    logger: {
      debug: push('debug'),
      info: push('info'),
      warn: push('warn'),
      error: push('error'),
    },
    scopedLogger: () => ({
      debug: push('debug'),
      info: push('info'),
      warn: push('warn'),
      error: push('error'),
    }),
  };
});

import { runReconcilePipeline } from './reconcilePipelineService';

const SOMALILAND_JID = '00000000-0000-4000-8000-00000000534f';
const DJIBOUTI_JID = '00000000-0000-4000-8000-00000000444a';

const ALERT_ID = 'alert-corridor-1';
const PROFORMA_ID = 'proforma-dj-001';
const NEW_TXN_ID = 'c1d2e3f4-aaaa-bbbb-cccc-000000000042';

const PROFORMA_CREATED_AT = '2026-06-05T08:30:00.000Z';

// Go tax result for the ALERT's (Somaliland) jurisdiction — used both by the
// reconcile pricing and the inline proforma reissue.
const TAX_RESULT = {
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
  id: 'vessel-corr-001',
  name: 'MV CORRIDOR',
  imo_number: 'TEST-CORR',
  mmsi: '999820001',
  category: 'CARGO',
  gross_tonnage_dwt: 30000,
  shipowner_id: 'owner-corr-001',
};

const AGENT = { id: 'agent-corr-001', email: 'agent@corridor.test', full_name: 'Corridor Agent' };

/**
 * Fake SupabaseClient covering BOTH the reconcile flow and the inline proforma
 * reissue (which re-selects the alert with the proforma-pipeline shape). The
 * alert row carries the union of both SELECTs' fields.
 */
function makeClient(
  opts: {
    proformaStatus?: string;
    proformaJurisdictionId?: string;
    proformaUsd?: number;
  } = {},
) {
  const captured: {
    txnInserts: Record<string, unknown>[];
    txnUpdates: Record<string, unknown>[];
    alertUpdates: Record<string, unknown>[];
  } = { txnInserts: [], txnUpdates: [], alertUpdates: [] };

  const alertRow = {
    id: ALERT_ID,
    mode: 'MARITIME',
    vessel_id: VESSEL.id,
    aircraft_id: null,
    imo_number: 'TEST-CORR',
    estimated_route_nm: 140,
    status: 'DEPARTED_EEZ',
    proforma_transaction_id: PROFORMA_ID,
    matched_agent_id: AGENT.id,
    jurisdiction_id: SOMALILAND_JID, // physical ground truth post-tracker
    arrived_at: '2026-06-10T08:00:00.000Z',
    vessel: VESSEL,
    aircraft: null,
  };

  const proformaRow = {
    id: PROFORMA_ID,
    tax_amount_usd: opts.proformaUsd ?? 532.0,
    document_type: 'PROFORMA',
    created_at: PROFORMA_CREATED_AT,
    status: opts.proformaStatus ?? 'PENDING',
    jurisdiction_id: opts.proformaJurisdictionId ?? DJIBOUTI_JID, // wrong sovereign
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
          captured.alertUpdates.push(payload);
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
      };
    }
    if (table === 'transactions') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: proformaRow, error: null }),
          })),
        })),
        insert: vi.fn((payload: Record<string, unknown>) => {
          captured.txnInserts.push(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: NEW_TXN_ID, ref: 'INV-2026-000042' },
                error: null,
              }),
            })),
          };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          captured.txnUpdates.push(payload);
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
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

  return { client: { from } as unknown as SupabaseClient, captured };
}

/** distance-final then tax/calculate — the normal reconcile fetch sequence. */
function reconcileFetchMock() {
  let calls = 0;
  return vi.fn(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ alert_id: ALERT_ID, total_distance_eez_nm: 140 }),
        text: async () => '',
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => TAX_RESULT,
      text: async () => '',
    });
  });
}

describe('runReconcilePipeline — corridor guard (W4-T6 cross-state mismatch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    logCalls.length = 0;
  });

  it('mismatch + UNPAID proforma → VOID/WAIVED single update + inline reissue + no FINAL this cycle', async () => {
    // The unpaid path never reaches distance-final: the ONLY fetch is the
    // reissue's tax/calculate call.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => TAX_RESULT,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured } = makeClient({ proformaStatus: 'PENDING' });
    const result = await runReconcilePipeline({
      alertId: ALERT_ID,
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      toleranceOverride: 10,
      dryRunEmail: true,
      dryRunStorage: true,
    });

    // Distinct outcome — the worker must NOT ack / mark RECONCILED this pass.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('reissued_under_correct_jurisdiction');

    // VOID + collections flip in a SINGLE update (mig 022 invariant-safe).
    expect(captured.txnUpdates).toEqual([{ status: 'VOID', collections_status: 'WAIVED' }]);

    // Exactly one INSERT and it is the reissued PROFORMA — no FINAL this cycle.
    expect(captured.txnInserts).toHaveLength(1);
    const reissued = captured.txnInserts[0];
    expect(reissued).toMatchObject({
      document_type: 'PROFORMA',
      jurisdiction_id: SOMALILAND_JID, // the ALERT's (correct) jurisdiction
      tariff_id: 'tariff-so-sea-001',
    });
    const breakdown = reissued.breakdown_json as Record<string, unknown>;
    expect(breakdown.jurisdiction_reissued_from).toBe(PROFORMA_ID);
    expect(breakdown.jurisdiction_provisional).toBeUndefined(); // post-tracker = ground truth

    // The reissue priced under the alert's jurisdiction (single tax call, no distance-final).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/tax/calculate');
    expect(JSON.parse(init.body as string).jurisdiction_id).toBe(SOMALILAND_JID);

    // Alert stays DEPARTED_EEZ: only the proforma pointer is re-pointed, never
    // a status flip (no PROFORMA_SENT, no RECONCILED) — redelivery re-runs reconcile.
    expect(captured.alertUpdates).toEqual([{ proforma_transaction_id: NEW_TXN_ID }]);

    // Structured events: warn on void, info on reissue.
    expect(logCalls).toContainEqual(
      expect.objectContaining({ level: 'warn', event: 'proforma_voided_jurisdiction_mismatch' }),
    );
    expect(logCalls).toContainEqual(
      expect.objectContaining({ level: 'info', event: 'proforma_reissued_cross_jurisdiction' }),
    );
  });

  it('mismatch + PAID proforma → no void, FINAL under ALERT jurisdiction + mismatch stamp + log.error', async () => {
    const fetchMock = reconcileFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured } = makeClient({ proformaStatus: 'PAID' });
    const result = await runReconcilePipeline({
      alertId: ALERT_ID,
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      toleranceOverride: 10,
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`pipeline failed: ${result.reason}`);
    expect(result.documentType).toBe('FINAL'); // delta 0% ≤ tolerance

    // The paid proforma row was NEVER touched.
    expect(captured.txnUpdates).toEqual([]);

    // The reconciliation row goes to the ALERT's sovereign and carries the
    // mismatch stamp in its INSERT payload (mig 089: immutable after INSERT).
    expect(captured.txnInserts).toHaveLength(1);
    const final = captured.txnInserts[0];
    expect(final).toMatchObject({
      document_type: 'FINAL',
      jurisdiction_id: SOMALILAND_JID,
      related_transaction_id: PROFORMA_ID,
    });
    const breakdown = final.breakdown_json as Record<string, unknown>;
    expect(breakdown.jurisdiction_mismatch_paid_proforma).toBe(true);
    expect(breakdown.proforma_jurisdiction_id).toBe(DJIBOUTI_JID);

    // Alert reconciles normally this cycle.
    expect(captured.alertUpdates).toEqual([
      { status: 'RECONCILED', final_transaction_id: NEW_TXN_ID },
    ]);

    // Settlement-split incident → structured error event with IDs only.
    expect(logCalls).toContainEqual(
      expect.objectContaining({
        level: 'error',
        event: 'jurisdiction_mismatch_paid_proforma',
        ctx: expect.objectContaining({
          alertId: ALERT_ID,
          proformaTransactionId: PROFORMA_ID,
          proformaJurisdictionId: DJIBOUTI_JID,
          alertJurisdictionId: SOMALILAND_JID,
        }),
      }),
    );
  });

  it('mismatch + PARTIALLY_PAID proforma → treated as paid (money collected): no void, flag stamped', async () => {
    const fetchMock = reconcileFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured } = makeClient({ proformaStatus: 'PARTIALLY_PAID' });
    const result = await runReconcilePipeline({
      alertId: ALERT_ID,
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      toleranceOverride: 10,
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`pipeline failed: ${result.reason}`);

    // Never destroy an encaissement: a partially-paid proforma is NOT voidable.
    expect(captured.txnUpdates).toEqual([]);
    const breakdown = captured.txnInserts[0].breakdown_json as Record<string, unknown>;
    expect(breakdown.jurisdiction_mismatch_paid_proforma).toBe(true);
    expect(logCalls).toContainEqual(
      expect.objectContaining({ level: 'error', event: 'jurisdiction_mismatch_paid_proforma' }),
    );
  });

  it('MATCH (regression): same jurisdiction → normal FINAL, no void, no corridor stamps, no corridor logs', async () => {
    const fetchMock = reconcileFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured } = makeClient({
      proformaStatus: 'PENDING',
      proformaJurisdictionId: SOMALILAND_JID, // matches the alert
    });
    const result = await runReconcilePipeline({
      alertId: ALERT_ID,
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      toleranceOverride: 10,
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`pipeline failed: ${result.reason}`);
    expect(result.documentType).toBe('FINAL');

    expect(captured.txnUpdates).toEqual([]);
    expect(captured.txnInserts).toHaveLength(1);
    const breakdown = captured.txnInserts[0].breakdown_json as Record<string, unknown>;
    expect(breakdown.jurisdiction_mismatch_paid_proforma).toBeUndefined();
    expect(breakdown.proforma_jurisdiction_id).toBeUndefined();
    expect(breakdown.jurisdiction_reissued_from).toBeUndefined();

    expect(captured.alertUpdates).toEqual([
      { status: 'RECONCILED', final_transaction_id: NEW_TXN_ID },
    ]);
    expect(
      logCalls.filter((c) =>
        [
          'proforma_voided_jurisdiction_mismatch',
          'proforma_reissued_cross_jurisdiction',
          'jurisdiction_mismatch_paid_proforma',
        ].includes(c.event),
      ),
    ).toEqual([]);
  });
});
