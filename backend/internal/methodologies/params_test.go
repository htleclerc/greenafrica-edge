package methodologies

import (
	"context"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/testdb"
)

func TestLookupMTOWFallback_ReadsParams(t *testing.T) {
	db := testdb.Open(t)
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
