package eez

// Zone represents a maritime jurisdiction zone.
type Zone string

const (
	ZonePortVicinity Zone = "PORT_VICINITY"
	ZoneEEZ          Zone = "EEZ"
	ZoneTransitLane  Zone = "TRANSIT_LANE"
	ZoneInternational Zone = "INTERNATIONAL"
)

// Point represents a geographic coordinate.
type Point struct {
	Lat float64
	Lng float64
}

// Polygon is a closed ring of points (GeoJSON-style: [lng, lat]).
type Polygon []Point

// ZoneDefinition binds a named zone to its polygon boundary.
type ZoneDefinition struct {
	Name    string
	Zone    Zone
	Polygon Polygon
}

// SomalilandZones returns the predefined EEZ zone boundaries.
// Mirrors the GeoJSON in public/geo/somaliland-eez.geojson.
func SomalilandZones() []ZoneDefinition {
	return []ZoneDefinition{
		{
			Name: "Port of Berbera",
			Zone: ZonePortVicinity,
			Polygon: Polygon{
				{10.42, 45.00}, {10.42, 45.08}, {10.48, 45.08},
				{10.48, 45.00}, {10.42, 45.00},
			},
		},
		{
			Name: "Port of Zeila",
			Zone: ZonePortVicinity,
			Polygon: Polygon{
				{11.33, 43.44}, {11.33, 43.52}, {11.39, 43.52},
				{11.39, 43.44}, {11.33, 43.44},
			},
		},
		{
			Name: "Somaliland EEZ",
			Zone: ZoneEEZ,
			Polygon: Polygon{
				{10.00, 43.20}, {10.00, 51.50}, {13.00, 51.50},
				{12.50, 49.00}, {11.80, 45.00}, {11.50, 43.20},
				{10.00, 43.20},
			},
		},
		{
			Name: "Gulf of Aden Transit Corridor",
			Zone: ZoneTransitLane,
			Polygon: Polygon{
				{11.50, 43.00}, {11.50, 51.50}, {13.50, 51.50},
				{13.50, 43.00}, {11.50, 43.00},
			},
		},
	}
}

// Detect returns the highest-priority zone containing the given point.
// Priority: PORT_VICINITY > EEZ > TRANSIT_LANE > INTERNATIONAL.
func Detect(lat, lng float64) Zone {
	zones := SomalilandZones()
	priorities := []Zone{ZonePortVicinity, ZoneEEZ, ZoneTransitLane}

	for _, targetZone := range priorities {
		for _, zd := range zones {
			if zd.Zone == targetZone && pointInPolygon(lat, lng, zd.Polygon) {
				return targetZone
			}
		}
	}

	return ZoneInternational
}

// pointInPolygon implements ray-casting algorithm.
func pointInPolygon(lat, lng float64, poly Polygon) bool {
	inside := false
	n := len(poly)
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		yi, xi := poly[i].Lat, poly[i].Lng
		yj, xj := poly[j].Lat, poly[j].Lng

		if (xi > lng) != (xj > lng) &&
			lat < (yj-yi)*(lng-xi)/(xj-xi)+yi {
			inside = !inside
		}
	}
	return inside
}
