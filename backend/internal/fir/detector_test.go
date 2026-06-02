package fir

import "testing"

func TestDetect(t *testing.T) {
	tests := []struct {
		name string
		lat  float64
		lng  float64
		want Zone
	}{
		{"Hargeisa", 9.52, 44.09, ZoneFIR},
		{"Berbera", 10.43, 45.01, ZoneFIR},
		{"Null Island (Atlantic)", 0, 0, ZoneOutside},
		{"Indian Ocean (20N 60E)", 20, 60, ZoneOutside},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Detect(tt.lat, tt.lng); got != tt.want {
				t.Errorf("Detect(%v, %v) = %q, want %q", tt.lat, tt.lng, got, tt.want)
			}
		})
	}
}
