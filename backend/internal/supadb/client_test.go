package supadb

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestOpen_PingsTheDB(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := Open(url)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// Test d'intégration : sans base joignable il n'a rien à prouver.
	// Échouer ici rendrait `go test ./...` rouge sur toute machine sans
	// stack locale, et le rouge cesserait alors de vouloir dire quelque chose.
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("base de test injoignable: %v (lancer Supabase en local)", err)
	}
}
