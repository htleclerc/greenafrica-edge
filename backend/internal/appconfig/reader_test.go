package appconfig

import (
	"context"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/testdb"
)

func openTestDB(t *testing.T) *Reader {
	t.Helper()
	db := testdb.Open(t)
	t.Cleanup(func() { db.Close() })
	return New(db)
}

func TestGetInt_ReadsSeededRate(t *testing.T) {
	r := openTestDB(t)
	got, err := r.GetInt(context.Background(), "carbon_tax.rate_usd_per_tco2")
	if err != nil {
		t.Fatalf("GetInt: %v", err)
	}
	if got != 40 {
		t.Fatalf("rate = %d, want 40", got)
	}
}

func TestGetBool_False(t *testing.T) {
	r := openTestDB(t)
	got, err := r.GetBool(context.Background(), "feature.ais_global_enabled")
	if err != nil {
		t.Fatalf("GetBool: %v", err)
	}
	if got {
		t.Fatalf("feature.ais_global_enabled = true, want false")
	}
}

func TestGetStringSlice_Languages(t *testing.T) {
	r := openTestDB(t)
	got, err := r.GetStringSlice(context.Background(), "proforma.languages_default")
	if err != nil {
		t.Fatalf("GetStringSlice: %v", err)
	}
	want := []string{"en", "fr", "ar"}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("languages = %v, want %v", got, want)
	}
}

func TestGetJSON_AllowList(t *testing.T) {
	r := openTestDB(t)
	var got map[string]interface{}
	err := r.GetJSON(context.Background(), "arrival.origin_port_allow_list", &got)
	if err != nil {
		t.Fatalf("GetJSON: %v", err)
	}
	// Verify the JSON was parsed into a map (allowing for any valid structure)
	if got == nil {
		t.Fatalf("GetJSON returned nil map, want populated map")
	}
}
