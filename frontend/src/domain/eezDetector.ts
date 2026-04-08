import { JurisdictionZone } from '@/types/secure';

interface GeoFeature {
  type: 'Feature';
  properties: { zone: string; name: string };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

let cachedZones: GeoFeatureCollection | null = null;

/**
 * Load the Somaliland EEZ GeoJSON zones.
 * Cached after first load.
 */
async function loadZones(): Promise<GeoFeatureCollection> {
  if (cachedZones) return cachedZones;

  const res = await fetch('/geo/somaliland-eez.geojson');
  cachedZones = (await res.json()) as GeoFeatureCollection;
  return cachedZones;
}

/**
 * Ray-casting point-in-polygon algorithm.
 * Returns true if the point (lat, lng) is inside the polygon.
 */
function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0]; // GeoJSON is [lng, lat]
    const xj = polygon[j][1], yj = polygon[j][0];

    const intersect =
      yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Detect which jurisdiction zone a vessel position falls into.
 * Priority: PORT_VICINITY > EEZ > TRANSIT_LANE > INTERNATIONAL
 */
export async function detectZone(lat: number, lng: number): Promise<JurisdictionZone> {
  const zones = await loadZones();

  // Check PORT_VICINITY first (highest priority, smallest area)
  for (const feature of zones.features) {
    if (feature.properties.zone === 'PORT_VICINITY') {
      if (pointInPolygon(lat, lng, feature.geometry.coordinates[0])) {
        return JurisdictionZone.PORT_VICINITY;
      }
    }
  }

  // Then EEZ
  for (const feature of zones.features) {
    if (feature.properties.zone === 'EEZ') {
      if (pointInPolygon(lat, lng, feature.geometry.coordinates[0])) {
        return JurisdictionZone.EEZ;
      }
    }
  }

  // Then TRANSIT_LANE
  for (const feature of zones.features) {
    if (feature.properties.zone === 'TRANSIT_LANE') {
      if (pointInPolygon(lat, lng, feature.geometry.coordinates[0])) {
        return JurisdictionZone.TRANSIT_LANE;
      }
    }
  }

  return JurisdictionZone.INTERNATIONAL;
}

/**
 * Synchronous version for server-side use (requires pre-loaded zones).
 */
export function detectZoneSync(
  lat: number,
  lng: number,
  zones: GeoFeatureCollection,
): JurisdictionZone {
  const zoneOrder = ['PORT_VICINITY', 'EEZ', 'TRANSIT_LANE'] as const;
  const zoneMap: Record<string, JurisdictionZone> = {
    PORT_VICINITY: JurisdictionZone.PORT_VICINITY,
    EEZ: JurisdictionZone.EEZ,
    TRANSIT_LANE: JurisdictionZone.TRANSIT_LANE,
  };

  for (const zoneName of zoneOrder) {
    for (const feature of zones.features) {
      if (feature.properties.zone === zoneName) {
        if (pointInPolygon(lat, lng, feature.geometry.coordinates[0])) {
          return zoneMap[zoneName];
        }
      }
    }
  }

  return JurisdictionZone.INTERNATIONAL;
}

export type { GeoFeatureCollection };
