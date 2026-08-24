// Package testdb ouvre la base de test des paquets backend.
//
// Il existe parce que treize paquets recopiaient le même préambule — variable
// d'environnement, URL de repli, ouverture — et que tous héritaient du même
// défaut : `sql.Open` ne compose pas. Il valide l'URL et rend un pool
// paresseux, si bien que la garde « base absente → saute le test » ne se
// déclenchait jamais. L'absence de Supabase local se manifestait à la première
// requête réelle, en `Fatalf`, et rendait `go test ./...` rouge en entier sur
// toute machine sans stack locale.
package testdb

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

// DefaultURL est le port du Postgres de la CLI Supabase en local.
const DefaultURL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

// Open rend une connexion utilisable, ou saute le test.
//
// Le ping est **borné** : sur un hôte qui ne répond pas du tout, un dial sans
// délai ferait pendre la suite jusqu'au temps mort par défaut du système.
//
// La fermeture est posée en `t.Cleanup` : les appelants qui gardent leur propre
// `defer db.Close()` ne risquent rien, fermer deux fois un `*sql.DB` est sans
// effet.
func Open(t *testing.T) *sql.DB {
	t.Helper()

	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = DefaultURL
	}

	db, err := supadb.Open(url)
	if err != nil {
		t.Skipf("supadb.Open: %v (base de test absente ; lancer Supabase en local)", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		t.Skipf("base de test injoignable: %v (lancer Supabase en local)", err)
	}

	t.Cleanup(func() { db.Close() })
	return db
}
