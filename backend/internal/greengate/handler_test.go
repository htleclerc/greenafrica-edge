package greengate

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func post(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/greengate/calculate", strings.NewReader(body))
	NewHandler().Calculate(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) CalculateResponse {
	t.Helper()
	var out CalculateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("réponse illisible (%s): %v", rec.Body.String(), err)
	}
	return out
}

// TRUST 1 : GT 2975, 13 escales. La pro-forma en production porte 36 675,60 USD
// et 916,89 tCO2 taxés — l'API doit rendre exactement cela.
func TestCalculateMaritime(t *testing.T) {
	rec := post(t, `{"mode":"MARITIME","gross_tonnage":2975,"n_calls":13}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d : %s", rec.Code, rec.Body.String())
	}
	out := decode(t, rec)
	if out.Maritime == nil {
		t.Fatal("branche maritime absente")
	}
	if out.Maritime.HybridUSD != 36675.60 {
		t.Errorf("USD = %v, attendu 36675.60", out.Maritime.HybridUSD)
	}
	if out.Maritime.BilledTCO2 != 916.89 {
		t.Errorf("tCO2 taxé = %v, attendu 916.89", out.Maritime.BilledTCO2)
	}
}

// Le mode par défaut est maritime : un appelant qui l'omet ne doit pas tomber
// en erreur, c'est le cas d'usage majoritaire.
func TestCalculateModeParDefaut(t *testing.T) {
	rec := post(t, `{"gross_tonnage":2975,"n_calls":13}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d : %s", rec.Code, rec.Body.String())
	}
	if out := decode(t, rec); out.Mode != "MARITIME" || out.Maritime == nil {
		t.Fatalf("mode = %q, maritime nil = %v", out.Mode, out.Maritime == nil)
	}
}

// La forme à préférer : le serveur applique lui-même max(ARR, DEP), donc un
// aller-retour rade↔quai ne compte pas double, même si l'appelant l'ignore.
func TestCalculateAvecEvenementsBruts(t *testing.T) {
	rec := post(t, `{"gross_tonnage":1687,
	                 "n_calls":99,
	                 "events":["ARRIVAL","DEPARTURE","ARRIVAL","DEPARTURE",
	                           "ARRIVAL","DEPARTURE","ARRIVAL","DEPARTURE",
	                           "ARRIVAL","DEPARTURE","ARRIVAL","DEPARTURE",
	                           "ARRIVAL","DEPARTURE","ARRIVAL","DEPARTURE"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d : %s", rec.Code, rec.Body.String())
	}
	out := decode(t, rec)
	// 16 mouvements → 8 escales, et non 16 : c'est ALAWAD1, 15 593,60 USD.
	if out.Maritime.NCalls != 8 {
		t.Errorf("escales = %d, attendu 8", out.Maritime.NCalls)
	}
	if out.Maritime.HybridUSD != 15593.60 {
		t.Errorf("USD = %v, attendu 15593.60", out.Maritime.HybridUSD)
	}
}

// Une jauge absente n'est pas une faute de syntaxe : 422, pour que l'appelant
// sache qu'il doit la résoudre via MasterData et non corriger sa requête.
func TestCalculateGTManquante(t *testing.T) {
	rec := post(t, `{"mode":"MARITIME","n_calls":3}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("code %d, attendu 422 : %s", rec.Code, rec.Body.String())
	}
}

func TestCalculateAviation(t *testing.T) {
	rec := post(t, `{"mode":"AVIATION","aircraft":"B737-800","route":"DXB-HGA"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d : %s", rec.Code, rec.Body.String())
	}
	out := decode(t, rec)
	if out.Aviation == nil || out.Aviation.TotalUSD != 1040.00 {
		t.Fatalf("aviation = %+v, attendu 1040.00 USD", out.Aviation)
	}
}

// Une route inconnue retombe sur le défaut de 4 h ; un appareil inconnu, non —
// il n'existe aucun repli défendable sur les facteurs d'émission.
func TestCalculateAviationInconnus(t *testing.T) {
	rec := post(t, `{"mode":"AVIATION","aircraft":"B737-800","route":"XXX-YYY"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("route inconnue : code %d, attendue acceptée", rec.Code)
	}
	if out := decode(t, rec); out.Aviation.TotalUSD != 1160.00 { // (2.5 + 4×3) × 2 × 40
		t.Errorf("USD = %v, attendu 1160.00", out.Aviation.TotalUSD)
	}

	rec = post(t, `{"mode":"AVIATION","aircraft":"CONCORDE","route":"ADD-HGA"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("appareil inconnu : code %d, attendu 422", rec.Code)
	}
}

func TestCalculateEntreesInvalides(t *testing.T) {
	if rec := post(t, `{"mode":"FLUVIAL"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("mode inconnu : code %d, attendu 400", rec.Code)
	}
	if rec := post(t, `{ pas du json`); rec.Code != http.StatusBadRequest {
		t.Errorf("JSON invalide : code %d, attendu 400", rec.Code)
	}
}
