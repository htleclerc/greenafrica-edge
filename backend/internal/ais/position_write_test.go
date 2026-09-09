package ais

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/config"
)

// frame construit une PositionReport realiste a partir de JSON : MetaData et
// Message sont des structs anonymes, les remplir a la main est illisible.
func frame(t *testing.T, mmsi string) AISMessage {
	t.Helper()
	raw := []byte(`{"MetaData":{"MMSI":` + mmsi + `,"MMSI_String":` + mmsi + `,` +
		`"ShipName":"MSC BERBERA","latitude":11.4,"longitude":45.2,` +
		`"time_utc":"2026-09-08 07:00:00 +0000 UTC"},` +
		`"MessageType":"PositionReport",` +
		`"Message":{"PositionReport":{"Sog":124,"TrueHeading":270}}}`)
	var msg AISMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("trame de test invalide: %v", err)
	}
	return msg
}

func recorder(t *testing.T, lookupBody string) (*Ingester, *[]string) {
	t.Helper()
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		if r.Method == http.MethodGet && r.URL.Path == "/rest/v1/vessels" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(lookupBody))
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(srv.Close)
	return &Ingester{cfg: &config.Config{SupabaseURL: srv.URL, SupabaseKey: "cle-de-test"}}, &calls
}

// Le coeur du correctif : l'ingesteur ne fabrique plus de navire. L'ancien code
// postait vers /rest/v1/vessels un payload sans gross_tonnage_dwt et avec
// imo_number="" — deux colonnes NOT NULL dont une UNIQUE — et prenait un
// HTTP 400 sur CHAQUE trame. Une PositionReport ne porte ni IMO ni tonnage :
// il n'y a rien d'honnete a mettre dans ce payload.
func TestNavireInconnuEstIgnoreEtNonCree(t *testing.T) {
	ing, calls := recorder(t, `[]`)

	ing.handlePositionReport(frame(t, "636012345"))

	for _, c := range *calls {
		if c == "POST /rest/v1/vessels" {
			t.Fatal("l'ingesteur a tente de creer un navire — il ne doit plus jamais le faire")
		}
		if c == "POST /rest/v1/vessel_positions" {
			t.Fatal("position ecrite pour un navire absent du registre")
		}
	}
	if ing.stats.PositionsSkippedUnknown != 1 {
		t.Fatalf("navires ignores = %d, attendu 1", ing.stats.PositionsSkippedUnknown)
	}
	if ing.stats.WriteErrors != 0 {
		t.Fatalf("erreurs d'ecriture = %d — un navire inconnu est le cas nominal, pas un echec",
			ing.stats.WriteErrors)
	}
	if ing.stats.PositionsWritten != 0 {
		t.Fatalf("positions ecrites = %d, attendu 0", ing.stats.PositionsWritten)
	}
}

// Le navire au registre, lui, doit toujours voir sa position enregistree.
func TestNavireConnuVoitSaPositionEcrite(t *testing.T) {
	ing, calls := recorder(t, `[{"id":"11111111-2222-4333-8444-555555555555"}]`)

	ing.handlePositionReport(frame(t, "636012345"))

	var wrote bool
	for _, c := range *calls {
		if c == "POST /rest/v1/vessel_positions" {
			wrote = true
		}
		if c == "POST /rest/v1/vessels" {
			t.Fatal("aucune creation de navire ne doit avoir lieu, meme pour un navire connu")
		}
	}
	if !wrote {
		t.Fatalf("aucune position ecrite ; appels observes: %v", *calls)
	}
	if ing.stats.PositionsWritten != 1 {
		t.Fatalf("positions ecrites = %d, attendu 1", ing.stats.PositionsWritten)
	}
	if ing.stats.PositionsSkippedUnknown != 0 {
		t.Fatalf("navires ignores = %d, attendu 0", ing.stats.PositionsSkippedUnknown)
	}
}
