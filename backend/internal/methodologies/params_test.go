package methodologies

import (
	"context"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestLookupMTOWFallback_ReadsParams(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	defer db.Close()

	slope, intercept, err := LookupMTOWFallback(context.Background(), db)
	if err != nil {
		t.Fatalf("LookupMTOWFallback: %v", err)
	}
	if slope <= 0 {
		t.Fatalf("slope = %v, want > 0", slope)
	}
	_ = intercept
}
