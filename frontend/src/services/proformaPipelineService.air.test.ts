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

// Email must never be invoked on the air path (no matched agent / recipient).
vi.mock('./emailService', () => ({
  sendInvoiceEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { runProformaPipeline } from './proformaPipelineService';

const SOMALILAND_JID = '00000000-0000-4000-8000-00000000534f';

// Air-mode tax result mirroring the W1-B /api/v1/tax/calculate contract.
const AIR_TAX_RESULT = {
  tco2: 2.6,
  usd_amount: 104.0,
  breakdown: {
    emission_source: 'ICAO_EDB',
    approximate: false,
    co2_kg_per_lto_cycle: 2600,
    lto_cycles: 1,
    rate_usd_per_tco2: 40,
  },
};

const AIRCRAFT = {
  id: 'ac-77-0001',
  icao24: '6oabc1',
  registration: '6O-AAA',
  icao_type: 'A320',
  engine_type: 'CFM56-5B',
  mtow_kg: 78000,
  operator_id: 'op-ghost-1',
  jurisdiction_id: SOMALILAND_JID,
};

/**
 * Fake SupabaseClient for the AIR branch. Captures the transactions insert
 * payload + the alert update payload so the test can assert the air contract.
 * With dryRunStorage/dryRunEmail the air path makes exactly three DB calls:
 *   arrival_alerts SELECT → transactions INSERT → arrival_alerts UPDATE.
 */
function makeClient(opts: { aircraft?: typeof AIRCRAFT | null; alertStatus?: string } = {}) {
  const captured: {
    insertedTxn?: Record<string, unknown>;
    alertUpdate?: Record<string, unknown>;
  } = {};

  const aircraft = opts.aircraft === undefined ? AIRCRAFT : opts.aircraft;
  const alertRow = {
    id: 'alert-air-1',
    mode: 'AIR',
    vessel_id: null,
    aircraft_id: aircraft ? aircraft.id : null,
    imo_number: null,
    estimated_route_nm: null,
    matched_agent_id: null, // air alerts have no matched agent
    status: opts.alertStatus ?? 'MATCHED_AUTO',
    vessel: null,
    aircraft,
  };

  const from = vi.fn((table: string) => {
    if (table === 'arrival_alerts') {
      return {
        // SELECT ... .eq('id', ...).single()
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: alertRow, error: null }),
          })),
        })),
        // UPDATE {...}.eq('id', ...)
        update: vi.fn((payload: Record<string, unknown>) => {
          captured.alertUpdate = payload;
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
      };
    }
    if (table === 'transactions') {
      return {
        // INSERT {...}.select('id, ref').single()
        insert: vi.fn((payload: Record<string, unknown>) => {
          captured.insertedTxn = payload;
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'b1c2d3e4-aaaa-bbbb-cccc-000000000077', ref: 'INV-2026-000077' },
                error: null,
              }),
            })),
          };
        }),
        // UPDATE (invoice_pdf_url) — only reached when not dry-run storage.
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

describe('runProformaPipeline — AIR branch (W1-C-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('AIR alert → POSTs the air contract → inserts a mode=AIR transaction (aircraft_id, null vessel_id)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => AIR_TAX_RESULT,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured } = makeClient();
    const result = await runProformaPipeline({
      alertId: 'alert-air-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      taxApiSecret: 'secret-xyz',
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.transactionId).toBe('b1c2d3e4-aaaa-bbbb-cccc-000000000077');

    // ── The air contract was POSTed to /api/v1/tax/calculate ──────────────
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('http://tax.test/api/v1/tax/calculate');
    const body = JSON.parse((calledInit as RequestInit).body as string);
    expect(body).toEqual({
      mode: 'AIR',
      icao_type: 'A320',
      engine_type: 'CFM56-5B',
      mtow_kg: 78000,
      lto_cycles: 1,
    });
    // Auth header propagated like the maritime path.
    expect((calledInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer secret-xyz',
    });

    // ── The inserted transaction is an AIR PROFORMA keyed on the aircraft ──
    expect(captured.insertedTxn).toMatchObject({
      mode: 'AIR',
      aircraft_id: 'ac-77-0001',
      vessel_id: null,
      vessel_name: '6O-AAA',        // registration as shared asset name
      vessel_imo: '6oabc1',         // icao24 as shared asset identifier
      transaction_type: 'ENTRY_TAX',
      emissions_tco2: 2.6,
      tax_amount_usd: 104.0,
      status: 'PENDING',
      collections_status: 'CURRENT',
      document_type: 'PROFORMA',
      arrival_alert_id: 'alert-air-1',
      shipowner_id: 'op-ghost-1',   // aircraft.operator_id
      agent_profile_id: null,
      rate_usd_per_tco2: 40,
      jurisdiction_id: SOMALILAND_JID,
    });
    expect(captured.insertedTxn?.breakdown_json).toEqual(AIR_TAX_RESULT.breakdown);
    // Maritime-only columns must NOT be present on an air row.
    expect(captured.insertedTxn).not.toHaveProperty('distance_eez_nm');
    expect(captured.insertedTxn).not.toHaveProperty('emission_factor_used_id');

    // ── Alert flipped to PROFORMA_SENT ────────────────────────────────────
    expect(captured.alertUpdate).toMatchObject({
      status: 'PROFORMA_SENT',
      proforma_transaction_id: 'b1c2d3e4-aaaa-bbbb-cccc-000000000077',
    });

    // ── Email never dispatched on the air path ────────────────────────────
    const { sendInvoiceEmail } = await import('./emailService');
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('fail-closed: a non-OK air tax response → ok:false, NO transaction inserted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'no AIR rate configured',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured, from } = makeClient();
    const result = await runProformaPipeline({
      alertId: 'alert-air-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('500');
    // No transactions table access at all → no proforma row.
    expect(captured.insertedTxn).toBeUndefined();
    expect(from).not.toHaveBeenCalledWith('transactions');
  });

  it('errors when the joined aircraft is missing (no tax call, no insert)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { client, captured } = makeClient({ aircraft: null });
    const result = await runProformaPipeline({
      alertId: 'alert-air-1',
      adminClient: client,
      taxApiUrl: 'http://tax.test',
      dryRunEmail: true,
      dryRunStorage: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('aircraft missing');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured.insertedTxn).toBeUndefined();
  });
});
