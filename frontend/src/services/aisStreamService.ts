import type { SupabaseClient } from '@supabase/supabase-js';
import type { VesselCategory } from '@/types/secure';

/**
 * AIS message types from aisstream.io WebSocket API.
 * Docs: https://aisstream.io/documentation
 */
interface AisStreamMessage {
  MessageType: string;
  MetaData: {
    MMSI: number;
    MMSI_String: string;
    ShipName: string;
    latitude: number;
    longitude: number;
    time_utc: string;
  };
  Message: {
    PositionReport?: {
      Cog: number;         // Course over ground (degrees)
      Sog: number;         // Speed over ground (knots x10)
      TrueHeading: number;
      Latitude: number;
      Longitude: number;
      NavigationalStatus: number;
    };
    ShipStaticData?: {
      ImoNumber: number;
      CallSign: string;
      Name: string;
      Type: number;        // AIS ship type code
      Dimension: {
        A: number; B: number; C: number; D: number;
      };
    };
  };
}

/** Map AIS ship type code to VesselCategory */
function aisTypeToCategory(aisType: number): VesselCategory {
  // AIS type codes: https://coast.noaa.gov/data/marinecadastre/ais/VesselTypeCodes2018.pdf
  if (aisType >= 70 && aisType <= 79) return 'CARGO' as VesselCategory;
  if (aisType >= 80 && aisType <= 89) return 'TANKER' as VesselCategory;
  if (aisType >= 60 && aisType <= 69) return 'FERRY' as VesselCategory;
  if (aisType === 35) return 'NAVAL' as VesselCategory;
  if (aisType >= 50 && aisType <= 59) return 'SCIENTIFIC' as VesselCategory;
  return 'CARGO' as VesselCategory; // default
}

/** Somaliland EEZ bounding box for aisstream.io subscription filter */
const SOMALILAND_BBOX = {
  MinLat: 9.5,
  MaxLat: 13.5,
  MinLng: 43.0,
  MaxLng: 52.0,
};

/**
 * Connect to aisstream.io WebSocket and ingest vessel positions into Supabase.
 * This is designed to run as a long-lived server process (not a serverless function).
 */
export async function startAisIngestion(
  supabaseAdmin: SupabaseClient,
  apiKey: string,
  onMessage?: (mmsi: string, lat: number, lng: number) => void,
): Promise<{ close: () => void }> {
  const WS_URL = 'wss://stream.aisstream.io/v0/stream';

  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    const subscriptionMessage = {
      APIKey: apiKey,
      BoundingBoxes: [[
        [SOMALILAND_BBOX.MinLat, SOMALILAND_BBOX.MinLng],
        [SOMALILAND_BBOX.MaxLat, SOMALILAND_BBOX.MaxLng],
      ]],
    };
    ws.send(JSON.stringify(subscriptionMessage));
    console.log('[AIS] Connected to aisstream.io, subscribed to Somaliland EEZ');
  };

  ws.onmessage = async (event) => {
    try {
      const msg: AisStreamMessage = JSON.parse(
        typeof event.data === 'string' ? event.data : event.data.toString(),
      );

      const mmsi = msg.MetaData.MMSI_String;
      const lat = msg.MetaData.latitude;
      const lng = msg.MetaData.longitude;

      if (!mmsi || !lat || !lng) return;

      onMessage?.(mmsi, lat, lng);

      // Upsert vessel position
      await supabaseAdmin.from('vessel_positions').insert({
        vessel_id: mmsi, // temporary: use MMSI as vessel ref until enriched
        lat,
        lng,
        heading: msg.Message.PositionReport?.TrueHeading ?? 0,
        speed_knots: (msg.Message.PositionReport?.Sog ?? 0) / 10,
        recorded_at: msg.MetaData.time_utc || new Date().toISOString(),
      });

      // Upsert vessel if we have static data
      if (msg.Message.ShipStaticData) {
        const staticData = msg.Message.ShipStaticData;
        const category = aisTypeToCategory(staticData.Type);

        await supabaseAdmin.from('vessels').upsert(
          {
            mmsi,
            imo_number: staticData.ImoNumber ? String(staticData.ImoNumber) : '',
            name: staticData.Name?.trim() || `VESSEL-${mmsi}`,
            call_sign: staticData.CallSign?.trim() || '',
            flag_code: '',
            category,
            compliance_status: 'APPROACHING',
          },
          { onConflict: 'mmsi' },
        );
      }
    } catch (err) {
      console.error('[AIS] Failed to process message:', err);
    }
  };

  ws.onerror = (err) => {
    console.error('[AIS] WebSocket error:', err);
  };

  ws.onclose = () => {
    console.log('[AIS] WebSocket closed. Reconnecting in 5s...');
    setTimeout(() => startAisIngestion(supabaseAdmin, apiKey, onMessage), 5000);
  };

  return { close: () => ws.close() };
}

export { SOMALILAND_BBOX };
export type { AisStreamMessage };
