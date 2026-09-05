import type { SupabaseClient } from '@supabase/supabase-js';
import { issueInvoiceDocument } from './invoiceIssuanceService';
import { notifyOwner } from './notificationService';
import { appBaseUrl } from '@/lib/appUrl';

/** Rôles habilités à émettre un document fiscal, du plus autoritaire au moins. */
const ISSUING_ROLES = ['SUPERADMIN', 'FINANCE_ADMIN', 'PORT_OFFICER'];

/**
 * Le pipeline s'exécute sans utilisateur connecté, mais l'audit d'émission exige
 * un profil réel (audit_logs.user_id est NOT NULL REFERENCES profiles). On retient
 * le profil staff le plus autoritaire disponible plutôt que d'inventer un
 * identifiant qui violerait la clé étrangère.
 */
async function resolveIssuingActor(
  db: SupabaseClient,
  jurisdictionId: string | null | undefined,
): Promise<{ id: string; fullName: string }> {
  const { data } = await db
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', ISSUING_ROLES)
    .limit(50);
  const rows = (data ?? []) as { id: string; full_name: string | null; email: string | null; role: string }[];
  if (!rows.length) {
    throw new Error(
      `proformaPipeline: no staff profile (${ISSUING_ROLES.join(', ')}) available to issue documents`
      + (jurisdictionId ? ` for jurisdiction ${jurisdictionId}` : ''),
    );
  }
  const chosen = [...rows].sort(
    (a, b) => ISSUING_ROLES.indexOf(a.role) - ISSUING_ROLES.indexOf(b.role),
  )[0];
  return { id: chosen.id, fullName: chosen.full_name || chosen.email || 'Automated pipeline' };
}

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

// Wedge 2: Go /api/v1/tax/calculate now returns tariff_id, jurisdiction_id, currency
// in the breakdown. Both breakdown types extend this shared tail.
type TaxBreakdownTail = {
  tariff_id?: string;
  jurisdiction_id?: string;
  currency?: string;
};

type TaxCalcResult = {
  tco2: number;
  usd_amount: number;
  breakdown: {
    distance_nm: number;
    emissions_factor_g_co2_per_nm: number;
    emissions_factor_source: string;
    emissions_factor_id: string;
    rate_usd_per_tco2: number;
  } & TaxBreakdownTail;
};

// Air-mode result (W1-B contract). Same envelope {tco2,usd_amount}, ICAO-LTO breakdown.
type AirTaxCalcResult = {
  tco2: number;
  usd_amount: number;
  breakdown: {
    emission_source: string;
    approximate: boolean;
    co2_kg_per_lto_cycle: number;
    lto_cycles: number;
    rate_usd_per_tco2: number;
  } & TaxBreakdownTail;
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
  /**
   * Corridor guard (Wedge 4 T6): when set, this run RE-ISSUES the proforma to
   * replace `fromTransactionId` after the reconcile pipeline detected a
   * cross-jurisdiction mismatch (proforma billed under the wrong sovereign).
   * In this mode:
   *   - the alert is accepted in DEPARTED_EEZ status (reconcile-time reissue);
   *   - the INSERT stamps `breakdown_json.jurisdiction_reissued_from` and never
   *     `jurisdiction_provisional` (the alert's jurisdiction is post-tracker
   *     ground truth by now);
   *   - the alert keeps its status — only `proforma_transaction_id` is
   *     re-pointed, so the queued reconcile re-runs against the new proforma.
   */
  reissue?: { fromTransactionId: string };
}

type RunResult =
  | { ok: true; transactionId: string }
  | { ok: false; reason: string };

// ── Actionable statuses: alerts in these states can have a pro-forma issued ──
const ACTIONABLE: ReadonlySet<string> = new Set(['MATCHED_AUTO', 'CLAIMED', 'ESCALATED']);

export async function runProformaPipeline(input: RunInput): Promise<RunResult> {
  const { alertId, adminClient: db, taxApiUrl } = input;

  // ── 1. Load the alert + asset + agent (+ owner if present) ──────────────
  // Polymorphic since W1-C (mig 076/077): a maritime alert carries a vessel, an
  // AIR alert carries an aircraft. Both joins are requested; `mode` selects which.
  const { data: alert, error: alertErr } = await db
    .from('arrival_alerts')
    .select(`
      id, mode, vessel_id, aircraft_id, imo_number, estimated_route_nm, matched_agent_id, status,
      jurisdiction_id, arrived_at,
      vessel:vessels ( id, name, imo_number, mmsi, category, gross_tonnage_dwt, shipowner_id ),
      aircraft:aircraft ( id, icao24, registration, icao_type, engine_type, mtow_kg, operator_id )
    `)
    .eq('id', alertId)
    .single();
  if (alertErr || !alert) {
    return { ok: false, reason: `alert not found: ${alertErr?.message ?? 'nil'}` };
  }

  if (input.reissue) {
    // Corridor reissue (W4-T6) happens at reconcile time — the vessel has
    // already departed. Any other status means this reissue call is misplaced.
    if (alert.status !== 'DEPARTED_EEZ') {
      return { ok: false, reason: `alert status ${alert.status} is not DEPARTED_EEZ (corridor reissue)` };
    }
  } else if (!ACTIONABLE.has(alert.status as string)) {
    return { ok: false, reason: `alert status ${alert.status} is not actionable` };
  }

  // ── Jurisdiction guard (W2): alert must carry a jurisdiction_id. ─────────
  if (!alert.jurisdiction_id) {
    return { ok: false, reason: 'alert missing jurisdiction_id' };
  }

  // ── AIR branch (W1-C): detected air arrival → air tax calc → mode='AIR' PROFORMA.
  // Le nom souverain n'est plus résolu ici : c'est le service d'émission qui lit
  // la juridiction (code + nom) au moment de rendre le document.
  if (alert.mode === 'AIR') {
    // Corridor guard (W4-T6) is maritime-only: AIR detection is in-FIR ground
    // truth (ADS-B), so air jurisdictions are never provisional and never reissued.
    if (input.reissue) {
      return { ok: false, reason: 'corridor reissue is maritime-only (AIR jurisdiction is ground truth)' };
    }
    return runAirProforma(input, alert);
  }

  const vessel = Array.isArray(alert.vessel) ? alert.vessel[0] : alert.vessel;
  if (!vessel) return { ok: false, reason: 'vessel missing' };
  if (!alert.matched_agent_id) return { ok: false, reason: 'alert has no matched agent' };

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
        jurisdiction_id: alert.jurisdiction_id ?? undefined,
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
  if (!tax.breakdown.tariff_id) {
    console.warn('[proformaPipeline] breakdown missing tariff_id — Go backend predates W2 tariffs; deploy ordering violated');
  }
  // Corridor guard (W4-T6): a maritime proforma issued BEFORE the vessel has
  // physically arrived (arrived_at still NULL) prices a provisionally-detected
  // jurisdiction — the nearest-port corridor stamp is not ground truth. Flag it
  // in the INSERT payload: mig 089 freezes breakdown_json after INSERT, so the
  // stamp can never be added (or removed) later. A corridor reissue is never
  // provisional — it runs post-tracker, under the alert's final jurisdiction —
  // and instead carries a back-reference to the voided proforma it replaces.
  const breakdownJson = {
    ...tax.breakdown,
    ...(input.reissue
      ? { jurisdiction_reissued_from: input.reissue.fromTransactionId }
      : alert.arrived_at == null
        ? { jurisdiction_provisional: true }
        : {}),
  };
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
      breakdown_json: breakdownJson,
      tariff_id: tax.breakdown.tariff_id ?? null,
      jurisdiction_id: alert.jurisdiction_id ?? null,
    })
    .select('id, ref')
    .single();
  if (txnErr || !txn) {
    return { ok: false, reason: `insert txn: ${txnErr?.message ?? 'nil'}` };
  }

  // ── 4. Émission du document ─────────────────────────────────────────────
  // Le pipeline ne rend plus le PDF lui-même : référence, hash, signature,
  // rendu, upload, persistance, audit et e-mail sont l'affaire du service
  // d'émission, partagé avec /api/invoices/generate. Entretenir une seconde
  // copie ici est exactement ce qui avait fait diverger les deux formats de
  // référence et les deux nomenclatures de stockage.
  const issuer = await resolveIssuingActor(db, alert.jurisdiction_id);
  const issued = await issueInvoiceDocument({
    admin: db,
    transactionId: txn.id,
    jurisdictionId: alert.jurisdiction_id,
    actor: issuer,
    origin: appBaseUrl(),
    sendEmail: !input.dryRunEmail,
    skipStorage: input.dryRunStorage,
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
  });
  if (!issued.ok) {
    return { ok: false, reason: `issuance: ${issued.error}` };
  }

  // Corridor reissue (W4-T6): keep the alert in DEPARTED_EEZ and only re-point
  // proforma_transaction_id — the queued reconcile message redelivers and re-runs
  // against the new proforma. Normal issuance flips to PROFORMA_SENT as before.
  const { error: alertUpdErr } = await db
    .from('arrival_alerts')
    .update(
      input.reissue
        ? { proforma_transaction_id: txn.id }
        : { status: 'PROFORMA_SENT', proforma_transaction_id: txn.id },
    )
    .eq('id', alertId);
  if (alertUpdErr) {
    return { ok: false, reason: `alert transition: ${alertUpdErr.message}` };
  }

  return { ok: true, transactionId: txn.id };
}

// ── Shape of the aircraft embed selected alongside the alert (W1-C). ──────────
// Note: aircraft.jurisdiction_id is intentionally excluded — jurisdiction for
// billing is always taken from the alert (the detection event), not the asset.
interface AircraftJoin {
  id: string;
  icao24: string | null;
  registration: string | null;
  icao_type: string | null;
  engine_type: string | null;
  mtow_kg: number | null;
  operator_id: string | null;
}

// The fields the air branch reads off the already-loaded alert. `aircraft` may
// arrive as an object or a single-element array depending on the PostgREST embed.
interface AlertForAir {
  id: string;
  aircraft_id: string | null;
  jurisdiction_id?: string | null;
  aircraft?: AircraftJoin | AircraftJoin[] | null;
}

/**
 * AIR branch of the pro-forma pipeline (W1-C-2).
 *
 * Mirrors the maritime tail but keyed on an aircraft instead of a vessel:
 *   1. Resolve the joined aircraft (error if missing).
 *   2. POST the W1-B air contract to /api/v1/tax/calculate (ICAO LTO). A missing
 *      AIR rate / unknown type → Go returns 422 no_active_tariff → we fail-closed
 *      (ok:false, no txn).
 *   3. Insert a mode='AIR' PROFORMA transactions row (aircraft_id set, vessel_id
 *      NULL; vessel_name/vessel_imo carry the aircraft registration/icao24 as the
 *      shared asset name/identifier). jurisdiction_id is taken from the alert
 *      (the billing event), not the aircraft join.
 *   4. Build the PDF, upload it (unless dry-run), flip the alert to PROFORMA_SENT.
 *
 * Air alerts have NO matched_agent_id (no air agent-matching in v1), so the email
 * step is skipped — there is no recipient.
 */
async function runAirProforma(input: RunInput, alert: AlertForAir): Promise<RunResult> {
  const { alertId, adminClient: db, taxApiUrl } = input;

  // ── Jurisdiction guard (W2): forwarded from the caller after the shared lookup.
  if (!alert.jurisdiction_id) {
    return { ok: false, reason: 'alert missing jurisdiction_id' };
  }

  // ── 1. Resolve the joined aircraft ───────────────────────────────────────
  const aircraft = Array.isArray(alert.aircraft) ? alert.aircraft[0] : alert.aircraft;
  if (!aircraft) return { ok: false, reason: 'aircraft missing' };

  // ── 2. Air tax calculation via Go backend (W1-B ICAO LTO contract) ───────
  const apiSecret =
    input.taxApiSecret
    ?? process.env.AFRICGREEN_API_SECRET
    ?? process.env.AIS_INGEST_SECRET
    ?? process.env.API_SECRET
    ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiSecret) headers['Authorization'] = `Bearer ${apiSecret}`;

  let tax: AirTaxCalcResult;
  try {
    const taxRes = await fetch(`${taxApiUrl}/api/v1/tax/calculate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode: 'AIR',
        icao_type: aircraft.icao_type,
        engine_type: aircraft.engine_type,
        mtow_kg: aircraft.mtow_kg,
        lto_cycles: 1,
        jurisdiction_id: alert.jurisdiction_id ?? undefined,
      }),
    });
    if (!taxRes.ok) {
      // Fail-closed: a missing AIR rate / unknown type → 422 no_active_tariff → no transaction.
      const body = await taxRes.text().catch(() => '');
      return { ok: false, reason: `tax api ${taxRes.status}: ${body}` };
    }
    tax = (await taxRes.json()) as AirTaxCalcResult;
  } catch (err) {
    return {
      ok: false,
      reason: `tax api fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── 3. Insert mode='AIR' PROFORMA transaction ────────────────────────────
  if (!tax.breakdown.tariff_id) {
    console.warn('[proformaPipeline] breakdown missing tariff_id — Go backend predates W2 tariffs; deploy ordering violated');
  }
  // Shared "asset name/identifier" columns (vessel_name/vessel_imo stay NOT NULL
  // post-mig-077): registration is the human name, icao24 the identifier.
  const assetName = aircraft.registration ?? aircraft.icao_type ?? aircraft.icao24 ?? 'AIRCRAFT';
  const assetIdent = aircraft.icao24 ?? aircraft.registration ?? 'UNKNOWN';
  const { data: txn, error: txnErr } = await db
    .from('transactions')
    .insert({
      aircraft_id: aircraft.id,
      vessel_id: null,
      mode: 'AIR',
      vessel_name: assetName,
      vessel_imo: assetIdent,
      transaction_type: 'ENTRY_TAX',
      emissions_tco2: tax.tco2,
      tax_amount_usd: tax.usd_amount,
      status: 'PENDING',
      collections_status: 'CURRENT',
      document_type: 'PROFORMA',
      arrival_alert_id: alertId,
      shipowner_id: aircraft.operator_id ?? null,
      agent_profile_id: null,
      rate_usd_per_tco2: tax.breakdown.rate_usd_per_tco2,
      breakdown_json: tax.breakdown,
      tariff_id: tax.breakdown.tariff_id ?? null,
      // jurisdiction_id is taken from the alert (the billing event), not the
      // aircraft join — the alert is stamped with the jurisdiction at detection time.
      jurisdiction_id: alert.jurisdiction_id ?? null,
    })
    .select('id, ref')
    .single();
  if (txnErr || !txn) {
    return { ok: false, reason: `insert txn: ${txnErr?.message ?? 'nil'}` };
  }

  // ── 4. Émission du document ──────────────────────────────────────────────
  // Comme le maritime, l'air délègue au service partagé. Air n'a pas d'agent
  // destinataire (pas d'appariement agent en v1) : sendEmail=false, l'opérateur
  // est prévenu in-app ci-dessous et rejoint par la boucle de relance ensuite.
  const issuer = await resolveIssuingActor(db, alert.jurisdiction_id);
  const issued = await issueInvoiceDocument({
    admin: db,
    transactionId: txn.id,
    jurisdictionId: alert.jurisdiction_id,
    actor: issuer,
    origin: appBaseUrl(),
    sendEmail: false,
    skipStorage: input.dryRunStorage,
    lineItems: [
      {
        zone: 'FIR',
        days: 1,
        emissionsTco2: tax.tco2,
        rate: tax.breakdown.rate_usd_per_tco2,
        amount: tax.usd_amount,
        description: 'Carbon Emissions Tax (pro-forma estimate, ICAO LTO cycle)',
        qtyDisplay: `${tax.tco2.toFixed(2)} tCO2`,
        rateDisplay: `$${tax.breakdown.rate_usd_per_tco2.toFixed(2)}/t`,
      },
    ],
  });
  if (!issued.ok) {
    return { ok: false, reason: `issuance: ${issued.error}` };
  }

  // ── 5. No agent email (air alerts have no matched agent). Instead notify ─
  //      the linked operator in-app so the proforma is visible in their portal
  //      immediately, and reaches them by email via the reminder loop once
  //      they onboard. Best-effort — must never block proforma issuance.
  if (aircraft.operator_id) {
    try {
      await notifyOwner(db, {
        shipownerId: aircraft.operator_id,
        kind: 'PROFORMA_ISSUED',
        params: {
          invoice_ref: issued.invoiceRef,
          amount_usd: tax.usd_amount,
          vessel_name: assetName,
        },
        deepLink: `/owner/invoices?focus=${txn.id}`,
      });
    } catch (err) {
      console.warn(
        '[proformaPipeline] air operator notification failed:',
        err instanceof Error ? err.message : String(err),
      );
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
