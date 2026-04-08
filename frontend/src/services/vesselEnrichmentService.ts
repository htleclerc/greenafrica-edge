import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Vessel enrichment service.
 * Enriches vessel records from AIS with additional data (flag, tonnage, emissions)
 * using publicly available sources like EU MRV THETIS data.
 */

interface EuMrvVesselRecord {
  imoNumber: string;
  name: string;
  flagCode: string;
  grossTonnage: number;
  totalCo2Emissions: number; // tonnes CO2
  totalFuelConsumption: number; // tonnes
  reportingPeriod: string;
}

/**
 * Fetch EU MRV emissions data for a specific vessel by IMO number.
 * EU MRV THETIS public data: https://mrv.emsa.europa.eu/
 *
 * Note: In production, this would fetch from a cached copy of the EU MRV CSV
 * stored in Supabase, refreshed monthly via a cron script.
 * For now, we check the local `eu_mrv_cache` table.
 */
export async function getEuMrvData(
  client: SupabaseClient,
  imoNumber: string,
): Promise<EuMrvVesselRecord | null> {
  const { data } = await client
    .from('eu_mrv_cache')
    .select('*')
    .eq('imo_number', imoNumber)
    .order('reporting_period', { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;

  return {
    imoNumber: data.imo_number,
    name: data.vessel_name,
    flagCode: data.flag_code,
    grossTonnage: data.gross_tonnage,
    totalCo2Emissions: data.total_co2_emissions,
    totalFuelConsumption: data.total_fuel_consumption,
    reportingPeriod: data.reporting_period,
  };
}

/**
 * Enrich a vessel in Supabase with external data.
 * Updates flag_code, gross_tonnage, and estimated_emissions if the vessel
 * has an IMO number and hasn't been enriched in the last 30 days.
 */
export async function enrichVessel(
  client: SupabaseClient,
  vesselId: string,
): Promise<boolean> {
  // Get the vessel
  const { data: vessel } = await client
    .from('vessels')
    .select('id, imo_number, flag_code, gross_tonnage_dwt, updated_at')
    .eq('id', vesselId)
    .single();

  if (!vessel || !vessel.imo_number) return false;

  // Skip if recently enriched (< 30 days)
  const lastUpdate = new Date(vessel.updated_at);
  const daysSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
  if (vessel.flag_code && vessel.gross_tonnage_dwt > 0 && daysSinceUpdate < 30) {
    return false;
  }

  // Try EU MRV data
  const mrvData = await getEuMrvData(client, vessel.imo_number);
  if (mrvData) {
    await client
      .from('vessels')
      .update({
        flag_code: mrvData.flagCode || vessel.flag_code,
        gross_tonnage_dwt: mrvData.grossTonnage || vessel.gross_tonnage_dwt,
        estimated_emissions_tco2: mrvData.totalCo2Emissions || 0,
      })
      .eq('id', vesselId);
    return true;
  }

  return false;
}

/**
 * Batch enrich all vessels that have an IMO number but are missing key data.
 */
export async function enrichAllVessels(client: SupabaseClient): Promise<number> {
  const { data: vessels } = await client
    .from('vessels')
    .select('id')
    .not('imo_number', 'is', null)
    .or('flag_code.is.null,flag_code.eq.,gross_tonnage_dwt.eq.0');

  if (!vessels) return 0;

  let enriched = 0;
  for (const vessel of vessels) {
    const success = await enrichVessel(client, vessel.id);
    if (success) enriched++;
  }

  return enriched;
}
