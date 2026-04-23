import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArrivalAlert, ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';

const ALERT_SELECT = `
  id, vessel_id, imo_number,
  detected_at, detected_lat, detected_lng, distance_to_port_nm,
  estimated_eta, estimated_route_nm,
  status, matched_agent_id, matched_via,
  proforma_transaction_id, final_transaction_id,
  arrived_at, departed_eez_at, cancelled_reason,
  created_at, updated_at
` as const;

const ALERT_WITH_VESSEL_SELECT = `${ALERT_SELECT},
  vessel:vessels ( id, name, imo_number, mmsi, category, gross_tonnage_dwt, flag_code )
` as const;

export async function listUnclaimedAlerts(
  db: SupabaseClient,
): Promise<ArrivalAlertWithVessel[]> {
  const { data, error } = await db
    .from('arrival_alerts')
    .select(ALERT_WITH_VESSEL_SELECT)
    .eq('status', 'UNCLAIMED')
    .order('detected_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ArrivalAlertWithVessel[];
}

export async function getAlert(
  db: SupabaseClient,
  id: string,
): Promise<ArrivalAlert | null> {
  const { data, error } = await db
    .from('arrival_alerts')
    .select(ALERT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as ArrivalAlert | null;
}

/**
 * Claim an UNCLAIMED alert as the given agent. Uses a conditional UPDATE so a
 * race between two concurrent agents is resolved by the database.
 */
export async function claimAlert(
  db: SupabaseClient,
  alertId: string,
  agentId: string,
): Promise<{ ok: true; alert: ArrivalAlert } | { ok: false; reason: string }> {
  const { data, error } = await db
    .from('arrival_alerts')
    .update({
      status: 'CLAIMED',
      matched_agent_id: agentId,
      matched_via: 'CLAIM',
    })
    .eq('id', alertId)
    .eq('status', 'UNCLAIMED')
    .select(ALERT_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: 'alert not found or already claimed' };
  return { ok: true, alert: data as ArrivalAlert };
}
