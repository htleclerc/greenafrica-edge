package fir

// Zone represents an airspace classification for a position report.
type Zone string

const (
	ZoneFIR     Zone = "FIR"
	ZoneOutside Zone = "OUTSIDE"
)

// Point represents a geographic coordinate.
type Point struct {
	Lat float64
	Lng float64
}

// Polygon is a closed ring of points.
type Polygon []Point

// SomalilandFIR is an APPROXIMATE bounding ring over Somaliland airspace
// (lat 7.5–11.8 N, lng 42.5–49.5 E). It is a coarse rectangle, NOT the
// official ICAO FIR boundary — refine against the published FIR before
// production billing. Mirrors the approximate maritime EEZ ring in
// backend/internal/eez.
//
// Deprecated: production paths read public.geofences via internal/geofence.
var SomalilandFIR = Polygon{
	{7.5, 42.5}, {7.5, 49.5}, {11.8, 49.5}, {11.8, 42.5}, {7.5, 42.5},
}

// Detect returns ZoneFIR if the point lies inside the Somaliland FIR ring,
// else ZoneOutside.
//
// Deprecated: production paths read public.geofences via internal/geofence.
func Detect(lat, lng float64) Zone {
	if pointInPolygon(lat, lng, SomalilandFIR) {
		return ZoneFIR
	}
	return ZoneOutside
}

// pointInPolygon implements ray-casting algorithm (copied from internal/eez).
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
