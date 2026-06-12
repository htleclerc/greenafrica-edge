import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateInvoicePdf,
  buildVerifyUrl,
  hashInvoiceFields,
  signInvoiceRef,
  type InvoiceData,
  type InvoiceBadge,
} from './invoiceService';
import { sendInvoiceEmail } from './emailService';
import { runProformaPipeline } from './proformaPipelineService';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('reconcilePipeline');

/**
 * Reconciliation pipeline — the orchestrator.
 *
 * Given an `arrival_alert_id` in status `DEPARTED_EEZ` with a linked pro-forma
 * transaction, this service:
 *   1. Loads the alert, vessel, agent, and the pro-forma transaction
 *   2. Fetches the real EEZ transit distance from the Go backend
 *   3. Calls the Go /tax/calculate endpoint with the real distance
 *   4. Decides FINAL / COMPLEMENT / REFUND based on delta vs tolerance_pct
 *   5. Inserts the reconciliation transactions row (related_transaction_id =
 *      pro-forma.id)
 *   6. Generates the PDF (reuses invoiceService)
 *   7. Uploads the PDF to Supabase Storage (unless dry-run)
 *   8. Emails the agent (reuses emailService, unless dry-run)
 *   9. Flips alert to RECONCILED + set final_transaction_id
 *
 * Mirrors the shape of `proformaPipelineService` — the two services share the
 * same invoiceService/emailService "real API" adaptations.
 *
 * Dry-run flags let tests skip Storage/Email side-effects while still
 * exercising the DB writes.
 */

type DocumentType = 'FINAL' | 'COMPLEMENT' | 'REFUND';

type TaxCalcResult = {
  tco2: number;
  usd_amount: number;
  breakdown: {
    distance_nm: number;
    emissions_factor_g_co2_per_nm: number;
    emissions_factor_source: string;
    emissions_factor_id: string;
    rate_usd_per_tco2: number;
    // Wedge 2: Go now returns tariff metadata in the breakdown.
    tariff_id?: string;
    jurisdiction_id?: string;
    currency?: string;
  };
};

type DistanceFinalResponse = {
  alert_id: string;
  total_distance_eez_nm: number;
};

interface RunInput {
  alertId: string;
  adminClient: SupabaseClient;
  taxApiUrl: string;
  /**
   * Bearer token used to authenticate against the Go backend's /api/v1/* routes.
   * Defaults to process.env.AFRICGREEN_API_SECRET / AIS_INGEST_SECRET / API_SECRET.
   */
  taxApiSecret?: string;
  /** Skip Resend call. DB writes still happen. */
  dryRunEmail?: boolean;
  /** Skip Storage upload. DB writes still happen; invoice_pdf_url stays null. */
  dryRunStorage?: boolean;
  /** Test hook to override app_config.reconciliation.tolerance_pct. */
  toleranceOverride?: number;
}

type RunResult =
  | { ok: true; transactionId: string; documentType: DocumentType }
  | { ok: false; reason: string };

const DEFAULT_TOLERANCE_PCT = 10;

export async function runReconcilePipeline(input: RunInput): Promise<RunResult> {
  const { alertId, adminClient: db, taxApiUrl } = input;

  // ── 1. Load the alert + vessel + agent (+ owner) ────────────────────────
  const { data: alert, error: alertErr } = await db
    .from('arrival_alerts')
    .select(`
      id, vessel_id, imo_number, status, proforma_transaction_id,
      matched_agent_id, jurisdiction_id,
      vessel:vessels ( id, name, imo_number, mmsi, category, gross_tonnage_dwt, shipowner_id )
    `)
    .eq('id', alertId)
    .single();
  if (alertErr || !alert) {
    return { ok: false, reason: `alert not found: ${alertErr?.message ?? 'nil'}` };
  }

  if (alert.status !== 'DEPARTED_EEZ') {
    return { ok: false, reason: `alert status ${alert.status} is not DEPARTED_EEZ` };
  }
  if (!alert.proforma_transaction_id) {
    return { ok: false, reason: 'alert has no linked pro-forma transaction' };
  }

  // ── Jurisdiction guard (W2): alert must carry a jurisdiction_id. ─────────
  if (!alert.jurisdiction_id) {
    return { ok: false, reason: 'alert missing jurisdiction_id' };
  }

  const vessel = Array.isArray(alert.vessel) ? alert.vessel[0] : alert.vessel;
  if (!vessel) return { ok: false, reason: 'vessel missing' };
  if (!alert.matched_agent_id) return { ok: false, reason: 'alert has no matched agent' };

  const { data: proforma, error: pfErr } = await db
    .from('transactions')
    .select('id, tax_amount_usd, document_type, created_at, status, jurisdiction_id')
    .eq('id', alert.proforma_transaction_id)
    .single();
  if (pfErr || !proforma) {
    return { ok: false, reason: `pro-forma not found: ${pfErr?.message ?? 'nil'}` };
  }
  const proformaUsd = Number(proforma.tax_amount_usd ?? 0);
  if (proformaUsd <= 0) {
    return { ok: false, reason: `pro-forma amount must be > 0 (got ${proformaUsd})` };
  }

  // ── Corridor guard (W4-T6): cross-state jurisdiction mismatch ─────────────
  // The proforma may have been issued pre-arrival under a provisionally-detected
  // jurisdiction (breakdown_json.jurisdiction_provisional). The alert's
  // jurisdiction_id is the physical ground truth post-tracker — compare them
  // BEFORE pricing the FINAL, otherwise the reconciliation inherits the wrong
  // sovereign's tariff and split rule.
  const proformaJurisdictionId = (proforma.jurisdiction_id ?? null) as string | null;
  const jurisdictionMismatch =
    proformaJurisdictionId !== null && proformaJurisdictionId !== alert.jurisdiction_id;
  // Money already collected under the wrong sovereign must NEVER be destroyed:
  // PAID / PARTIALLY_PAID rows carry confirmed payments (mig 051 recompute).
  const proformaHasMoney = proforma.status === 'PAID' || proforma.status === 'PARTIALLY_PAID';

  if (jurisdictionMismatch && !proformaHasMoney) {
    // Unpaid proforma billed under the wrong jurisdiction → VOID it and reissue
    // under the alert's actual jurisdiction. status + collections_status flip in
    // a SINGLE UPDATE so the mig 022 invariant trigger sees a consistent pair
    // (VOID/WAIVED carries "no money owed" semantics: the voided row drops out of
    // the credit-usage view and the collections cron). Both columns are FREE
    // under mig 089 — the fiscal snapshot itself stays frozen.
    log.warn('proforma_voided_jurisdiction_mismatch', {
      alertId,
      proformaTransactionId: proforma.id,
      proformaJurisdictionId,
      alertJurisdictionId: alert.jurisdiction_id,
      proformaStatus: proforma.status,
    });
    const { error: voidErr } = await db
      .from('transactions')
      .update({ status: 'VOID', collections_status: 'WAIVED' })
      .eq('id', proforma.id);
    if (voidErr) {
      return { ok: false, reason: `void proforma: ${voidErr.message}` };
    }

    const reissued = await runProformaPipeline({
      alertId,
      adminClient: db,
      taxApiUrl,
      taxApiSecret: input.taxApiSecret,
      dryRunEmail: input.dryRunEmail,
      dryRunStorage: input.dryRunStorage,
      reissue: { fromTransactionId: proforma.id },
    });
    if (!reissued.ok) {
      // The proforma is already VOID; redelivery retries this branch (re-void is
      // a no-op UPDATE) until the reissue lands.
      log.error('proforma_reissue_failed', {
        alertId,
        voidedTransactionId: proforma.id,
        alertJurisdictionId: alert.jurisdiction_id,
      });
      return { ok: false, reason: `cross-jurisdiction reissue failed: ${reissued.reason}` };
    }
    log.info('proforma_reissued_cross_jurisdiction', {
      alertId,
      voidedTransactionId: proforma.id,
      newTransactionId: reissued.transactionId,
      alertJurisdictionId: alert.jurisdiction_id,
    });
    // ok:false on purpose: the queue worker must NOT ack / mark RECONCILED this
    // cycle. pgmq redelivers the message and the reconcile re-runs against the
    // freshly issued proforma (jurisdictions now match → normal path).
    return { ok: false, reason: 'reissued_under_correct_jurisdiction' };
  }

  if (jurisdictionMismatch && proformaHasMoney) {
    // Money was collected under the WRONG sovereign — never touch the paid
    // proforma row. Reconciliation proceeds under the ALERT's jurisdiction (the
    // FINAL/COMPLEMENT goes to the correct sovereign) and the reconciliation row
    // is stamped (at INSERT — mig 089) for the settlement audit. The two states'
    // ledgers now disagree by the proforma amount: manual inter-state correction
    // required → ops incident.
    log.error('jurisdiction_mismatch_paid_proforma', {
      alertId,
      proformaTransactionId: proforma.id,
      proformaJurisdictionId,
      alertJurisdictionId: alert.jurisdiction_id,
      proformaStatus: proforma.status,
      proformaUsd,
    });
  }

  const { data: agent, error: agentErr } = await db
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', alert.matched_agent_id)
    .single();
  if (agentErr || !agent?.email) {
    return { ok: false, reason: `agent missing email: ${agentErr?.message ?? 'nil'}` };
  }

  // Optional: look up shipowner name for PDF "Issued to" field
  let ownerName = agent.full_name ?? agent.email;
  if (vessel.shipowner_id) {
    const { data: owner } = await db
      .from('shipowners')
      .select('name')
      .eq('id', vessel.shipowner_id)
      .maybeSingle();
    if (owner?.name) ownerName = owner.name;
  }

  // ── Resolve jurisdiction display name for the invoice PDF (W2). ──────────
  // The alert's jurisdiction_id is NOT NULL (enforced at detection time), so the
  // row will exist; fallback to the legacy label if the lookup somehow fails.
  const { data: juri } = await db
    .from('jurisdictions')
    .select('name')
    .eq('id', alert.jurisdiction_id)
    .maybeSingle();
  const jurisdictionName = juri?.name ?? 'Republic of Somaliland';

  // ── 2. Shared Go-backend auth headers ───────────────────────────────────
  const apiSecret =
    input.taxApiSecret
    ?? process.env.AFRICGREEN_API_SECRET
    ?? process.env.AIS_INGEST_SECRET
    ?? process.env.API_SECRET
    ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiSecret) headers['Authorization'] = `Bearer ${apiSecret}`;

  // ── 3. Fetch real EEZ distance ──────────────────────────────────────────
  let realDistanceNm: number;
  try {
    const distRes = await fetch(
      `${taxApiUrl}/api/v1/alerts/${encodeURIComponent(alertId)}/distance-final`,
      { method: 'GET', headers },
    );
    if (!distRes.ok) {
      const body = await distRes.text().catch(() => '');
      return { ok: false, reason: `distance-final ${distRes.status}: ${body}` };
    }
    const distPayload = (await distRes.json()) as DistanceFinalResponse;
    realDistanceNm = Number(distPayload.total_distance_eez_nm ?? 0);
  } catch (err) {
    return {
      ok: false,
      reason: `distance-final fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (realDistanceNm <= 0) {
    return { ok: false, reason: `real EEZ distance is ${realDistanceNm} (check positions + alert timestamps)` };
  }

  // ── 4. Tax calculation with real distance ───────────────────────────────
  // as_of pins the tariff version to the proforma's issuance date — the
  // reconcile delta measures distance, not decree changes (D3 issuance-date rule).
  const d = new Date(proforma.created_at as string);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, reason: 'proforma created_at invalid' };
  }
  const proformaAsOf = d.toISOString().slice(0, 10);
  let tax: TaxCalcResult;
  try {
    const taxRes = await fetch(`${taxApiUrl}/api/v1/tax/calculate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        imo: vessel.imo_number,
        category: vessel.category,
        gross_tonnage: vessel.gross_tonnage_dwt,
        distance_nm: realDistanceNm,
        jurisdiction_id: alert.jurisdiction_id ?? undefined,
        as_of: proformaAsOf,
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
  const realUsd = Number(tax.usd_amount ?? 0);

  // ── 5. Decision tree: FINAL / COMPLEMENT / REFUND ───────────────────────
  let tolerancePct = input.toleranceOverride;
  if (tolerancePct === undefined) {
    const { data: cfg } = await db
      .from('app_config')
      .select('value')
      .eq('key', 'reconciliation.tolerance_pct')
      .maybeSingle();
    if (cfg?.value != null) {
      const raw = typeof cfg.value === 'number' ? cfg.value : Number(cfg.value);
      if (Number.isFinite(raw)) tolerancePct = raw;
    }
  }
  if (tolerancePct === undefined || !Number.isFinite(tolerancePct)) {
    tolerancePct = DEFAULT_TOLERANCE_PCT;
  }

  const deltaPct = Math.abs(realUsd - proformaUsd) / proformaUsd * 100;

  let documentType: DocumentType;
  let txnAmountUsd: number;
  let txnStatus: 'PENDING' | 'PAID' | 'CREDIT_NOTE_ISSUED';
  let collectionsStatus: 'CURRENT' | 'PAID' | 'WAIVED';
  let badge: InvoiceBadge;

  if (deltaPct <= tolerancePct) {
    documentType = 'FINAL';
    txnAmountUsd = realUsd;
    txnStatus = 'PAID';
    collectionsStatus = 'PAID';
    badge = 'PAID';
  } else if (realUsd > proformaUsd) {
    documentType = 'COMPLEMENT';
    txnAmountUsd = realUsd - proformaUsd;
    txnStatus = 'PENDING';
    collectionsStatus = 'CURRENT';
    badge = 'TO PAY';
  } else {
    documentType = 'REFUND';
    // NOTE: the mig-022 check constraint (partial_paid_usd >= 0 AND
    // partial_paid_usd <= tax_amount_usd) disallows a negative tax_amount_usd.
    // Store the positive magnitude; `document_type='REFUND'` +
    // `status='CREDIT_NOTE_ISSUED'` + `breakdown_json.refundDirection='OWED_TO_AGENT'`
    // carry the accounting direction. Downstream reporting should key off
    // document_type, not sign.
    txnAmountUsd = proformaUsd - realUsd;
    txnStatus = 'CREDIT_NOTE_ISSUED';
    collectionsStatus = 'WAIVED';
    // Badge enum has no REFUND value; EXEMPT is the closest neutral option.
    badge = 'EXEMPT';
  }

  const reconciliationNote =
    documentType === 'FINAL'
      ? `Reconciled within tolerance (delta ${deltaPct.toFixed(2)}% <= ${tolerancePct}%).`
      : documentType === 'COMPLEMENT'
        ? `Real USD exceeded pro-forma by ${deltaPct.toFixed(2)}% (> ${tolerancePct}% tolerance). Additional charge issued.`
        : `Real USD below pro-forma by ${deltaPct.toFixed(2)}% (> ${tolerancePct}% tolerance). Refund / credit note issued.`;

  const breakdownJson = {
    ...tax.breakdown,
    reconciliationNote,
    deltaPct,
    tolerancePct,
    proformaUsd,
    realUsd,
    proformaTransactionId: proforma.id,
    // For REFUND: the row's positive tax_amount_usd is the magnitude; this
    // flag tells finance that the amount is owed back to the agent, not due
    // from them. FINAL / COMPLEMENT are always OWED_TO_AUTHORITY.
    refundDirection: documentType === 'REFUND' ? 'OWED_TO_AGENT' : 'OWED_TO_AUTHORITY',
    // Corridor guard (W4-T6): the proforma was PAID under a different
    // jurisdiction than the alert's ground truth. Stamped at INSERT (mig 089
    // freezes breakdown_json) so settlement ops can find every row needing a
    // manual inter-state correction.
    ...(jurisdictionMismatch && proformaHasMoney
      ? {
          jurisdiction_mismatch_paid_proforma: true,
          proforma_jurisdiction_id: proformaJurisdictionId,
        }
      : {}),
  };

  // ── 6. Insert reconciliation transaction ────────────────────────────────
  if (!tax.breakdown.tariff_id) {
    console.warn('[reconcilePipeline] breakdown missing tariff_id — Go backend predates W2 tariffs; deploy ordering violated');
  }
  const { data: txn, error: txnErr } = await db
    .from('transactions')
    .insert({
      vessel_id: vessel.id,
      vessel_name: vessel.name,
      vessel_imo: vessel.imo_number,
      transaction_type: 'ENTRY_TAX',
      emissions_tco2: tax.tco2,
      tax_amount_usd: txnAmountUsd,
      status: txnStatus,
      collections_status: collectionsStatus,
      document_type: documentType,
      arrival_alert_id: alertId,
      agent_profile_id: alert.matched_agent_id,
      shipowner_id: vessel.shipowner_id ?? null,
      related_transaction_id: proforma.id,
      distance_eez_nm: realDistanceNm,
      emission_factor_used_id: tax.breakdown.emissions_factor_id || null,
      rate_usd_per_tco2: tax.breakdown.rate_usd_per_tco2,
      breakdown_json: breakdownJson,
      tariff_id: tax.breakdown.tariff_id ?? null,
      jurisdiction_id: alert.jurisdiction_id ?? null,
    })
    .select('id, ref')
    .single();
  if (txnErr || !txn) {
    return { ok: false, reason: `insert txn: ${txnErr?.message ?? 'nil'}` };
  }

  // The auto-trigger on transactions generates `ref` as INV-YYYY-NNNNNN. We
  // build a dedicated ref off the transaction UUID so the /verify route's
  // parseInvoiceRef can map it back to the right document type. For REFUND,
  // use RCT- (credit note is conceptually a receipt of refund); FINAL and
  // COMPLEMENT use INV- (they remain tax invoices).
  const year = new Date().getFullYear();
  const suffix = txn.id.split('-')[1].toUpperCase();
  const refPrefix = documentType === 'REFUND' ? 'RCT' : 'INV';
  const invoiceRef = `${refPrefix}-${year}-${suffix}`;

  // ── 7. Build InvoiceData + PDF ──────────────────────────────────────────
  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const periodStart = issuedAt.toISOString().slice(0, 10);
  const periodEnd = dueAt.toISOString().slice(0, 10);
  // Displayed total on the PDF. Always positive by construction — direction
  // is carried by `document_type` + `breakdown_json.refundDirection`.
  const displayTotal = Math.abs(txnAmountUsd);

  // hashInvoiceFields schema (Zod 4) only accepts mode ∈ {'invoice','proforma'}.
  // All three reconciliation flavors ship as 'invoice' — the proforma stage is
  // already closed out by this point.
  const canonicalFields = {
    invoiceRef,
    vesselImo: vessel.imo_number,
    vesselName: vessel.name,
    ownerName,
    totalUsd: displayTotal,
    periodStart,
    periodEnd,
    mode: 'invoice' as const,
  };
  const contentHash = hashInvoiceFields(canonicalFields);
  const signature = signInvoiceRef(invoiceRef, contentHash);
  const verifyUrl = buildVerifyUrl(invoiceRef, { contentHash, signature });

  const lineDescription =
    documentType === 'FINAL'
      ? 'Carbon Emissions Tax — Final reconciliation (IMO Cubic Law)'
      : documentType === 'COMPLEMENT'
        ? 'Carbon Emissions Tax — Complement (real distance exceeds pro-forma estimate)'
        : 'Carbon Emissions Tax — Refund / credit note (real distance below pro-forma estimate)';

  const invoiceData: InvoiceData = {
    invoiceRef,
    vesselName: vessel.name,
    vesselImo: vessel.imo_number,
    vesselMmsi: vessel.mmsi ?? '',
    ownerName,
    jurisdiction: jurisdictionName,
    periodStart,
    periodEnd,
    emissionsTco2: tax.tco2,
    ratePerTco2: tax.breakdown.rate_usd_per_tco2,
    subtotalUsd: displayTotal,
    exemptionUsd: 0,
    totalUsd: displayTotal,
    mode: 'invoice',
    badge,
    verifyUrl,
    lineItems: [
      {
        zone: 'EEZ',
        days: 1,
        emissionsTco2: tax.tco2,
        rate: tax.breakdown.rate_usd_per_tco2,
        amount: displayTotal,
        description: lineDescription,
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

  // ── 8. Upload PDF (unless dry-run) ──────────────────────────────────────
  let pdfPath: string | null = null;
  if (!input.dryRunStorage) {
    const path = `reconciliations/${invoiceRef}.pdf`;
    const { error: upErr } = await db.storage
      .from('documents')
      .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) return { ok: false, reason: `upload: ${upErr.message}` };
    pdfPath = path;
  }

  // ── 9. Email the agent (unless dry-run) ─────────────────────────────────
  if (!input.dryRunEmail) {
    const emailResult = await sendInvoiceEmail({
      to: agent.email,
      recipientName: agent.full_name ?? agent.email,
      vesselName: vessel.name,
      invoiceRef,
      amountUsd: displayTotal,
      dueDate: periodEnd,
      mode: 'invoice',
      badge,
      pdfBuffer: pdfBytes,
      verifyUrl,
    });
    if (!emailResult.success) {
      return { ok: false, reason: `email: ${emailResult.error ?? 'unknown'}` };
    }
  }

  // ── 10. Persist pdf_url + flip alert to RECONCILED ──────────────────────
  if (pdfPath) {
    const { error: urlErr } = await db
      .from('transactions')
      .update({ invoice_pdf_url: pdfPath })
      .eq('id', txn.id);
    if (urlErr) {
      console.warn('[reconcilePipeline] pdf_url update failed:', urlErr.message);
    }
  }

  const { error: alertUpdErr } = await db
    .from('arrival_alerts')
    .update({ status: 'RECONCILED', final_transaction_id: txn.id })
    .eq('id', alertId);
  if (alertUpdErr) {
    return { ok: false, reason: `alert transition: ${alertUpdErr.message}` };
  }

  return { ok: true, transactionId: txn.id, documentType };
}
