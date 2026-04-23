package geo

import (
	"math"
	"testing"
)

func TestHaversineNM_Known(t *testing.T) {
	// Berbera (10.43, 45.02) to Aden (12.78, 45.04) ≈ 141 NM
	got := HaversineNM(10.43, 45.02, 12.78, 45.04)
	if math.Abs(got-141) > 3 {
		t.Fatalf("got %.2f NM, want ~141", got)
	}
}

func TestHaversineNM_Zero(t *testing.T) {
	got := HaversineNM(10, 45, 10, 45)
	if got != 0 {
		t.Fatalf("want 0, got %v", got)
	}
}
