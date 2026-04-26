// Package geo provides stateless geographic math.
// Unit of distance: nautical miles (NM), using mean earth radius 3440.065 NM.
package geo

import "math"

const earthRadiusNM = 3440.065

// HaversineNM returns the great-circle distance between two lat/lng pairs.
func HaversineNM(lat1, lng1, lat2, lng2 float64) float64 {
	rlat1 := lat1 * math.Pi / 180
	rlat2 := lat2 * math.Pi / 180
	dlat := (lat2 - lat1) * math.Pi / 180
	dlng := (lng2 - lng1) * math.Pi / 180

	a := math.Sin(dlat/2)*math.Sin(dlat/2) +
		math.Cos(rlat1)*math.Cos(rlat2)*math.Sin(dlng/2)*math.Sin(dlng/2)
	return earthRadiusNM * 2 * math.Asin(math.Sqrt(a))
}
