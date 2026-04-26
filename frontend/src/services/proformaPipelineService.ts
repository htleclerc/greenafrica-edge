import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateInvoicePdf,
  buildVerifyUrl,
  hashInvoiceFields,
  signInvoiceRef,
  type InvoiceData,
} from './invoiceService';
import { sendInvoiceEmail } from './emailService';

/**
 * Pro-forma pipeline — the orchestrator.
 *
 * Given an `arrival_alert_id`, runs the full pre-arrival pro-forma flow:
 *   1. Load alert + vessel + agent (+ optional shipowner)
 *   2. Call Go backend /api/v1/tax/calculate with estimated route distance
 *   3. Insert a transactions row with document_type='PROFORMA'
 *   4. Generate the PDF (reuses invoiceService)
 *   5. Upload the PDF to Supabase Storage
 *   6. Email the agent (reuses emailService)
 *   7. Flip alert to PROFORMA_SENT + set proforma_transaction_id
 *
 * Dry-run flags let the integration test skip the Storage/Email side-effects
 * without skipping the DB writes — that's the point of the test.
 */

type TaxCalcResult = {
  tco2: number;
  usd_amount: number;
  breakdown: {
    distance_nm: number;
    emissions_factor_g_co2_per_nm: number;
    emissions_factor_source: string;
    emissions_factor_id: string;
    rate_usd_per_tco2: number;
  };
};

interface RunInput {
  alertId: string;
  adminClient: SupabaseClient;
  taxApiUrl: string;
  /**
   * Bearer token used to authenticate against the Go backend's /api/v1/* routes.
   * Defaults to process.env.AFRICGREEN_API_SECRET / AIS_INGEST_SECRET / API_SECRET.
   * The Go Auth middleware skips /health and /, so only tax/calculate needs this.
   */
  taxApiSecret?: string;
  /** Skip Resend call. DB writes still happen. */
  dryRunEmail?: boolean;
  /** Skip Storage upload. DB writes still happen; invoice_pdf_url stays null. */
  dryRunStorage?: boolean;
}

type RunResult =
  | { ok: true; transactionId: string }
  | { ok: false; reason: string };

// ── Actionable statuses: alerts in these states can have a pro-forma issued ──
const ACTIONABLE: ReadonlySet<string> = new Set(['MATCHED_AUTO', 'CLAIMED', 'ESCALATED']);

export async function runProformaPipeline(input: RunInput): Promise<RunResult> {
  const { alertId, adminClient: db, taxApiUrl } = input;

  // ── 1. Load the alert + vessel + agent (+ owner if present) ─────────────
  const { data: alert, error: alertErr } = await db
    .from('arrival_alerts')
    .select(`
      id, vessel_id, imo_number, estimated_route_nm, matched_agent_id, status,
      vessel:vessels ( id, name, imo_number, mmsi, category, gross_tonnage_dwt, shipowner_id )
    `)
    .eq('id', alertId)
    .single();
  if (alertErr || !alert) {
    return { ok: false, reason: `alert not found: ${alertErr?.message ?? 'nil'}` };
  }

  if (!ACTIONABLE.has(alert.status as string)) {
    return { ok: false, reason: `alert status ${alert.status} is not actionable` };
  }

  const vessel = Array.isArray(alert.vessel) ? alert.vessel[0] : alert.vessel;
  if (!vessel) return { ok: false, reason: 'vessel missing' };
  if (!alert.matched_agent_id) return { ok: false, reason: 'alert has no matched agent' };

  const { data: agent, error: agentErr } = await db
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', alert.matched_agent_id)
    .single();
  if (agentErr || !agent?.email) {
    return { ok: false, reason: `agent missing email: ${agentErr?.message ?? 'nil'}` };
  }

  // Optional: look up shipowner name for PDF "Issued to / owner" field
  let ownerName = agent.full_name ?? agent.email;
  if (vessel.shipowner_id) {
    const { data: owner } = await db
      .from('shipowners')
      .select('name')
      .eq('id', vessel.shipowner_id)
      .maybeSingle();
    if (owner?.name) ownerName = owner.name;
  }

  // ── 2. Tax calculation via Go backend ───────────────────────────────────
  const estimatedRouteNm = Number(alert.estimated_route_nm ?? 0);
  const apiSecret =
    input.taxApiSecret
    ?? process.env.AFRICGREEN_API_SECRET
    ?? process.env.AIS_INGEST_SECRET
    ?? process.env.API_SECRET
    ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiSecret) headers['Authorization'] = `Bearer ${apiSecret}`;

  let tax: TaxCalcResult;
  try {
    const taxRes = await fetch(`${taxApiUrl}/api/v1/tax/calculate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        imo: vessel.imo_number,
        category: vessel.category,
        gross_tonnage: vessel.gross_tonnage_dwt,
        distance_nm: estimatedRouteNm,
      }),
    });
    if (!taxRes.ok) {
      const body = await taxRes.text().catch(() => '');
      return { ok: false, reason: `tax api ${taxRes.status}: ${body}` };
    }
    tax = (await taxRes.json()) as TaxCalcResult;
  } catch (err) {
    return {
      ok: false,
      reason: `tax api fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── 3. Insert PROFORMA transaction ──────────────────────────────────────
  const { data: txn, error: txnErr } = await db
    .from('transactions')
    .insert({
      vessel_id: vessel.id,
      vessel_name: vessel.name,
      vessel_imo: vessel.imo_number,
      transaction_type: 'ENTRY_TAX',
      emissions_tco2: tax.tco2,
      tax_amount_usd: tax.usd_amount,
      status: 'PENDING',
      collections_status: 'CURRENT',
      document_type: 'PROFORMA',
      arrival_alert_id: alertId,
      agent_profile_id: alert.matched_agent_id,
      shipowner_id: vessel.shipowner_id ?? null,
      distance_eez_nm: tax.breakdown.distance_nm,
      emission_factor_used_id: tax.breakdown.emissions_factor_id || null,
      rate_usd_per_tco2: tax.breakdown.rate_usd_per_tco2,
      breakdown_json: tax.breakdown,
    })
    .select('id, ref')
    .single();
  if (txnErr || !txn) {
    return { ok: false, reason: `insert txn: ${txnErr?.message ?? 'nil'}` };
  }

  // The auto-trigger on transactions generates `ref` as INV-YYYY-NNNNNN. For
  // a PROFORMA row we want a PRO- prefix so /verify can parse `parseInvoiceRef`
  // back to a document type. We derive the pro-forma ref from the transaction
  // UUID's first segment (matches buildReceiptRef convention).
  const year = new Date().getFullYear();
  const suffix = txn.id.split('-')[1].toUpperCase();
  const invoiceRef = `PRO-${year}-${suffix}`;

  // ── 4. Build InvoiceData + PDF ──────────────────────────────────────────
  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const periodStart = issuedAt.toISOString().slice(0, 10);
  const periodEnd = dueAt.toISOString().slice(0, 10);

  const canonicalFields = {
    invoiceRef,
    vesselImo: vessel.imo_number,
    vesselName: vessel.name,
    ownerName,
    totalUsd: tax.usd_amount,
    periodStart,
    periodEnd,
    mode: 'proforma' as const,
  };
  const contentHash = hashInvoiceFields(canonicalFields);
  const signature = signInvoiceRef(invoiceRef, contentHash);
  const verifyUrl = buildVerifyUrl(invoiceRef, { contentHash, signature });

  const invoiceData: InvoiceData = {
    invoiceRef,
    vesselName: vessel.name,
    vesselImo: vessel.imo_number,
    vesselMmsi: vessel.mmsi ?? '',
    ownerName,
    jurisdiction: 'Republic of Somaliland',
    periodStart,
    periodEnd,
    emissionsTco2: tax.tco2,
    ratePerTco2: tax.breakdown.rate_usd_per_tco2,
    subtotalUsd: tax.usd_amount,
    exemptionUsd: 0,
    totalUsd: tax.usd_amount,
    mode: 'proforma',
    badge: 'TO PAY',
    verifyUrl,
    lineItems: [
      {
        zone: 'EEZ',
        days: 1,
        emissionsTco2: tax.tco2,
        rate: tax.breakdown.rate_usd_per_tco2,
        amount: tax.usd_amount,
        description: 'Carbon Emissions Tax (pro-forma estimate, IMO Cubic Law)',
        qtyDisplay: `${tax.tco2.toFixed(2)} tCO2`,
        rateDisplay: `$${tax.breakdown.rate_usd_per_tco2.toFixed(2)}/t`,
      },
    ],
  };

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateInvoicePdf(invoiceData);
  } catch (err) {
    return {
      ok: false,
      reason: `pdf gen failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── 5. Upload PDF (unless dry-run) ──────────────────────────────────────
  let pdfPath: string | null = null;
  if (!input.dryRunStorage) {
    const path = `proformas/${invoiceRef}.pdf`;
    const { error: upErr } = await db.storage
      .from('documents')
      .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) return { ok: false, reason: `upload: ${upErr.message}` };
    pdfPath = path;
  }

  // ── 6. Email the agent (unless dry-run) ─────────────────────────────────
  if (!input.dryRunEmail) {
    const emailResult = await sendInvoiceEmail({
      to: agent.email,
      recipientName: agent.full_name ?? agent.email,
      vesselName: vessel.name,
      invoiceRef,
      amountUsd: tax.usd_amount,
      dueDate: periodEnd,
      mode: 'proforma',
      badge: 'TO PAY',
      pdfBuffer: pdfBytes,
      verifyUrl,
    });
    if (!emailResult.success) {
      return { ok: false, reason: `email: ${emailResult.error ?? 'unknown'}` };
    }
  }

  // ── 7. Persist pdf_url + flip alert to PROFORMA_SENT ────────────────────
  if (pdfPath) {
    const { error: urlErr } = await db
      .from('transactions')
      .update({ invoice_pdf_url: pdfPath })
      .eq('id', txn.id);
    if (urlErr) {
      // Non-fatal — the transaction and alert transition are the critical bits.
      console.warn('[proformaPipeline] pdf_url update failed:', urlErr.message);
    }
  }

  const { error: alertUpdErr } = await db
    .from('arrival_alerts')
    .update({ status: 'PROFORMA_SENT', proforma_transaction_id: txn.id })
    .eq('id', alertId);
  if (alertUpdErr) {
    return { ok: false, reason: `alert transition: ${alertUpdErr.message}` };
  }

  return { ok: true, transactionId: txn.id };
}
