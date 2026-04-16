import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * EU MRV (Monitoring, Reporting, Verification) Emissions Service
 *
 * Source: THETIS-MRV — https://mrv.emsa.europa.eu/
 * Public data: individual ship-level CO2 emissions, fuel consumption, distance.
 * Free bulk CSV download available at: https://mrv.emsa.europa.eu/#public/emission-report
 *
 * Strategy: download CSV periodically → parse → upsert into eu_mrv_cache table.
 * The vesselEnrichmentService then reads from eu_mrv_cache to enrich vessel records.
 */

interface EuMrvCsvRow {
  imo_number: string;
  vessel_name: string;
  ship_type: string;
  flag_code: string;
  reporting_period: string;
  gross_tonnage: number;
  total_fuel_consumption_mt: number;
  total_co2_emissions_mt: number;
  transport_work_million_tkm: number;
  distance_travelled_nm: number;
  time_at_sea_hours: number;
  average_speed_knots: number;
}

/**
 * Parse EU MRV CSV content into structured rows.
 * The CSV has headers and uses comma separator.
 */
export function parseEuMrvCsv(csvContent: string): EuMrvCsvRow[] {
  const lines = csvContent.split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

  const findCol = (keywords: string[]): number =>
    headers.findIndex((h) => keywords.some((k) => h.includes(k)));

  const imoIdx = findCol(['imo']);
  const nameIdx = findCol(['name']);
  const typeIdx = findCol(['ship type', 'shiptype']);
  const flagIdx = findCol(['flag']);
  const periodIdx = findCol(['reporting period', 'year']);
  const tonnageIdx = findCol(['gross tonnage']);
  const fuelIdx = findCol(['fuel consumption']);
  const co2Idx = findCol(['co2']);
  const workIdx = findCol(['transport work']);
  const distIdx = findCol(['distance']);
  const seaIdx = findCol(['time at sea']);
  const speedIdx = findCol(['average speed']);

  const rows: EuMrvCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) continue;

    const imo = cols[imoIdx] || '';
    if (!imo || imo.length < 7) continue;

    rows.push({
      imo_number: imo,
      vessel_name: cols[nameIdx] || '',
      ship_type: cols[typeIdx] || '',
      flag_code: cols[flagIdx] || '',
      reporting_period: cols[periodIdx] || '',
      gross_tonnage: parseFloat(cols[tonnageIdx]) || 0,
      total_fuel_consumption_mt: parseFloat(cols[fuelIdx]) || 0,
      total_co2_emissions_mt: parseFloat(cols[co2Idx]) || 0,
      transport_work_million_tkm: parseFloat(cols[workIdx]) || 0,
      distance_travelled_nm: parseFloat(cols[distIdx]) || 0,
      time_at_sea_hours: parseFloat(cols[seaIdx]) || 0,
      average_speed_knots: parseFloat(cols[speedIdx]) || 0,
    });
  }

  return rows;
}

/**
 * Sync EU MRV CSV data into the eu_mrv_cache table in Supabase.
 * Upserts by (imo_number, reporting_period) composite key.
 */
export async function syncEuMrvToSupabase(
  client: SupabaseClient,
  csvContent: string,
): Promise<{ synced: number; errors: number }> {
  const rows = parseEuMrvCsv(csvContent);
  let synced = 0;
  let errors = 0;

  // Batch upsert in chunks of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
      imo_number: r.imo_number,
      vessel_name: r.vessel_name,
      ship_type: r.ship_type,
      flag_code: r.flag_code,
      reporting_period: r.reporting_period,
      gross_tonnage: r.gross_tonnage,
      total_fuel_consumption: r.total_fuel_consumption_mt,
      total_co2_emissions: r.total_co2_emissions_mt,
      transport_work: r.transport_work_million_tkm,
      distance_nm: r.distance_travelled_nm,
      time_at_sea_hours: r.time_at_sea_hours,
      average_speed_knots: r.average_speed_knots,
    }));

    const { error } = await client
      .from('eu_mrv_cache')
      .upsert(batch, { onConflict: 'imo_number,reporting_period' });

    if (error) {
      console.error(`[EU-MRV] Batch error at offset ${i}:`, error.message);
      errors += batch.length;
    } else {
      synced += batch.length;
    }
  }

  return { synced, errors };
}

/**
 * Get emissions data for a specific vessel by IMO number.
 * Returns the most recent reporting period.
 */
export async function getVesselEmissions(
  client: SupabaseClient,
  imoNumber: string,
): Promise<EuMrvCsvRow | null> {
  const { data } = await client
    .from('eu_mrv_cache')
    .select('*')
    .eq('imo_number', imoNumber)
    .order('reporting_period', { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;

  return {
    imo_number: data.imo_number,
    vessel_name: data.vessel_name,
    ship_type: data.ship_type,
    flag_code: data.flag_code,
    reporting_period: data.reporting_period,
    gross_tonnage: data.gross_tonnage,
    total_fuel_consumption_mt: data.total_fuel_consumption,
    total_co2_emissions_mt: data.total_co2_emissions,
    transport_work_million_tkm: data.transport_work,
    distance_travelled_nm: data.distance_nm,
    time_at_sea_hours: data.time_at_sea_hours,
    average_speed_knots: data.average_speed_knots,
  };
}
