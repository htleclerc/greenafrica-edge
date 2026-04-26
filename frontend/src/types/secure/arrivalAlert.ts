export type ArrivalAlertStatus =
  | 'DETECTED'
  | 'MATCHED_AUTO'
  | 'UNCLAIMED'
  | 'CLAIMED'
  | 'ESCALATED'
  | 'PROFORMA_SENT'
  | 'ARRIVED'
  | 'DEPARTED_EEZ'
  | 'RECONCILED'
  | 'CANCELLED';

export type MatchedVia = 'AUTO_MAPPING' | 'CLAIM' | 'PORT_OFFICER';

export interface ArrivalAlert {
  id: string;
  vessel_id: string;
  imo_number: string;
  detected_at: string;
  detected_lat: number;
  detected_lng: number;
  distance_to_port_nm: number;
  estimated_eta: string | null;
  estimated_route_nm: number | null;
  status: ArrivalAlertStatus;
  matched_agent_id: string | null;
  matched_via: MatchedVia | null;
  proforma_transaction_id: string | null;
  final_transaction_id: string | null;
  arrived_at: string | null;
  departed_eez_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArrivalAlertWithVessel extends ArrivalAlert {
  vessel: {
    id: string;
    name: string;
    imo_number: string;
    mmsi: string;
    category: string;
    gross_tonnage_dwt: number;
    flag_code: string;
  };
}
