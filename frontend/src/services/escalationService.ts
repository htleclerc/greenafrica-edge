import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';

export type EscalatedAlert = ArrivalAlertWithVessel;

export interface UnpaidProforma {
  transactionId: string;
  transactionRef: string | null;
  vesselName: string;
  vesselImo: string;
  taxAmountUsd: number;
  arrivedAt: string | null;
  ownerEscalationDueAt: string;
  shipownerId: string | null;
  shipownerOfficialEmail: string | null;
  shipownerOfficialEmailSource: 'AGENT_CLAIM' | 'PORT_OFFICER' | 'EQUASIS_VERIFIED' | 'VESSELFINDER_VERIFIED' | null;
  agentProfileId: string | null;
  agentEmail: string | null;
}

const ALERT_WITH_VESSEL_SELECT = `
  id, vessel_id, imo_number,
  detected_at, detected_lat, detected_lng, distance_to_port_nm,
  estimated_eta, estimated_route_nm,
  status, matched_agent_id, matched_via,
  proforma_transaction_id, final_transaction_id,
  arrived_at, departed_eez_at, cancelled_reason,
  created_at, updated_at,
  vessel:vessels ( id, name, imo_number, mmsi, category, gross_tonnage_dwt, flag_code )
`;

export async function listUnclaimedEscalated(
  db: SupabaseClient,
): Promise<EscalatedAlert[]> {
  const { data, error } = await db
    .from('arrival_alerts')
    .select(ALERT_WITH_VESSEL_SELECT)
    .eq('status', 'ESCALATED')
    .order('detected_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as EscalatedAlert[];
}

export async function listUnpaidProformas(
  db: SupabaseClient,
): Promise<UnpaidProforma[]> {
  const { data, error } = await db
    .from('transactions')
    .select(`
      id, ref, vessel_name, vessel_imo, tax_amount_usd,
      owner_escalation_due_at,
      shipowner_id, agent_profile_id,
      alert:arrival_alerts!transactions_arrival_alert_id_fkey ( arrived_at ),
      shipowner:shipowners ( official_email, official_email_source ),
      agent:profiles!transactions_agent_profile_id_fkey ( email )
    `)
    .eq('document_type', 'PROFORMA')
    .eq('status', 'PENDING')
    .not('owner_escalation_due_at', 'is', null)
    .is('escalated_to_owner_at', null)
    .order('owner_escalation_due_at', { ascending: true });

  if (error) throw error;

  type RawRow = {
    id: string;
    ref: string | null;
    vessel_name: string;
    vessel_imo: string;
    tax_amount_usd: number | string;
    owner_escalation_due_at: string;
    shipowner_id: string | null;
    agent_profile_id: string | null;
    alert: { arrived_at: string | null } | { arrived_at: string | null }[] | null;
    shipowner:
      | { official_email: string | null; official_email_source: UnpaidProforma['shipownerOfficialEmailSource'] }
      | { official_email: string | null; official_email_source: UnpaidProforma['shipownerOfficialEmailSource'] }[]
      | null;
    agent: { email: string } | { email: string }[] | null;
  };

  return (data as unknown as RawRow[]).map((r) => {
    const alert = Array.isArray(r.alert) ? r.alert[0] : r.alert;
    const so = Array.isArray(r.shipowner) ? r.shipowner[0] : r.shipowner;
    const ag = Array.isArray(r.agent) ? r.agent[0] : r.agent;
    return {
      transactionId: r.id,
      transactionRef: r.ref,
      vesselName: r.vessel_name,
      vesselImo: r.vessel_imo,
      taxAmountUsd: Number(r.tax_amount_usd),
      arrivedAt: alert?.arrived_at ?? null,
      ownerEscalationDueAt: r.owner_escalation_due_at,
      shipownerId: r.shipowner_id,
      shipownerOfficialEmail: so?.official_email ?? null,
      shipownerOfficialEmailSource: so?.official_email_source ?? null,
      agentProfileId: r.agent_profile_id,
      agentEmail: ag?.email ?? null,
    };
  });
}
