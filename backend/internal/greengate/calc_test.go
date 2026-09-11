package greengate

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// Les douze vecteurs de l'implémentation de référence Python. Ce sont des
// montants de factures RÉELLEMENT ÉMISES à des débiteurs, dont deux
// contestent formellement. Toute implémentation qui ne les reproduit pas au
// centime est fausse.
var vectorsMaritime = []struct {
	name   string
	gt     int
	nCalls int
	usd    float64
}{
	{"PGC PERIKLIS PRO-2026-064068", 6248, 1, 4565.20},
	{"ALAWAD1 PRO-2026-064035", 1687, 8, 15593.60}, // le piège d'arrondi
	{"PIONEER EAGLE PRO-2026-064074", 1660, 2, 3861.60},
	{"SAFEEN PEARL", 9999, 6, 37180.80},
	{"ELREEDY STAR", 13066, 6, 44244.00},
}

var vectorsAviation = []struct {
	name     string
	aircraft string
	route    string
	usd      float64
}{
	{"Ethiopian ET-309", "B737-800", "ADD-HGA", 560.00},
	{"FlyDubai FZ-501", "B737-800", "DXB-HGA", 1040.00},
	{"Air Arabia G9-2231", "A320", "SHJ-HGA", 1040.00},
	{"Daallo D3-555", "B737-700", "DXB-HGA", 860.00},
	{"Daallo D3-122", "B737-700", "JED-HGA", 760.00},
	{"Jubba JR-205", "Q400", "MGQ-HGA", 224.00},
	{"Charter CH-901", "B737-F", "DXB-BBO", 1040.00},
}

func TestVecteursDeReference(t *testing.T) {
	for _, c := range vectorsMaritime {
		got, err := CalcMaritime(c.gt, c.nCalls)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if math.Abs(got.HybridUSD-c.usd) >= 0.005 {
			t.Errorf("%s (GT %d × %d) = %.2f, attendu %.2f", c.name, c.gt, c.nCalls, got.HybridUSD, c.usd)
		}
	}
	for _, c := range vectorsAviation {
		got, err := CalcAviation(c.aircraft, c.route)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if math.Abs(got.TotalUSD-c.usd) >= 0.005 {
			t.Errorf("%s (%s %s) = %.2f, attendu %.2f", c.name, c.aircraft, c.route, got.TotalUSD, c.usd)
		}
	}
}

// Le cas qui a déjà produit une erreur en production. Une réimplémentation
// half-up donne 48,74 puis 15 596,80 ; la facture remise porte 15 593,60.
// On vérifie l'étape fautive elle-même, pas seulement le total : un total
// juste par compensation resterait faux.
func TestPiegeArrondiALAWAD1(t *testing.T) {
	got, err := CalcMaritime(1687, 8)
	if err != nil {
		t.Fatal(err)
	}
	if got.PerCall.BilledTCO2 != 48.73 {
		t.Fatalf("tCO2 taxé par escale = %v, attendu 48.73 (48.74 = arrondi half-up, faux)", got.PerCall.BilledTCO2)
	}
	if got.HybridUSD != 15593.60 {
		t.Fatalf("total = %v, attendu 15593.60 (15596.80 = half-up, écart de 3,20 USD)", got.HybridUSD)
	}
}

// Round doit se comporter comme le round() de Python, y compris sur les
// égalités, qui vont au pair le plus proche — pas à l'opposé de zéro comme
// math.Round.
func TestRoundSuitPython(t *testing.T) {
	cases := []struct {
		in   float64
		nd   int
		want float64
	}{
		{48.735, 2, 48.73},  // binaire juste en dessous : vers le bas
		{2.675, 2, 2.67},    // le cas d'école
		{0.5, 0, 0.0},       // égalité exacte → pair
		{1.5, 0, 2.0},       // égalité exacte → pair
		{2.5, 0, 2.0},       // math.Round donnerait 3
		{-2.5, 0, -2.0},     // idem, côté négatif
		{2.665, 2, 2.67},    // binaire juste au dessus : vers le haut
		{97.4682, 2, 97.47}, //  étape tCO2 d'ALAWAD1
	}
	for _, c := range cases {
		if got := Round(c.in, c.nd); got != c.want {
			t.Errorf("Round(%v, %d) = %v, attendu %v", c.in, c.nd, got, c.want)
		}
	}
}

type goldenVessel struct {
	// Ni IMO ni nom : le vecteur n'a besoin que des entrees et des sorties.
	// Lier ici un navire identifiable au montant qui lui est facture n'ajoute
	// rien au test et fait entrer une creance en litige dans le depot.
	ID         string  `json:"id"`
	GT         int     `json:"gt"`
	NCalls     int     `json:"n_calls"`
	FuelT      float64 `json:"fuel_t"`
	TCO2Total  float64 `json:"tco2_total"`
	BilledTCO2 float64 `json:"billed_tco2"`
	USD        float64 `json:"usd"`
}

type goldenFlight struct {
	Aircraft    string  `json:"aircraft"`
	Route       string  `json:"route"`
	TaxableTCO2 float64 `json:"taxable_tco2"`
	USD         float64 `json:"usd"`
}

type goldenSweep struct {
	GT     int     `json:"gt"`
	FuelT  float64 `json:"fuel_t"`
	TCO2   float64 `json:"tco2"`
	Billed float64 `json:"billed"`
	USD    float64 `json:"usd"`
}

type golden struct {
	Maritime []goldenVessel     `json:"maritime"`
	Aviation []goldenFlight     `json:"aviation"`
	Sweep    []goldenSweep      `json:"sweep"`
	Totaux   map[string]float64 `json:"totaux_de_controle"`
}

func loadGolden(t *testing.T) golden {
	t.Helper()
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatalf("golden introuvable: %v", err)
	}
	var g golden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatalf("golden illisible: %v", err)
	}
	return g
}

// Les 110 navires réellement facturés par les deux campagnes, recalculés un à
// un. C'est la preuve que le portage Go reproduit le Python, et pas seulement
// sur cinq cas choisis.
func TestLes110NaviresDesCampagnes(t *testing.T) {
	g := loadGolden(t)
	if len(g.Maritime) != 110 {
		t.Fatalf("golden : %d navires, attendu 110", len(g.Maritime))
	}
	for _, v := range g.Maritime {
		got, err := CalcMaritime(v.GT, v.NCalls)
		if err != nil {
			t.Fatalf("%s: %v", v.ID, err)
		}
		if got.HybridUSD != v.USD {
			t.Errorf("%s (GT %d × %d) USD = %.2f, attendu %.2f", v.ID, v.GT, v.NCalls, got.HybridUSD, v.USD)
		}
		if got.VoyageFuelT != v.FuelT {
			t.Errorf("%s soute = %v, attendu %v", v.ID, got.VoyageFuelT, v.FuelT)
		}
		if got.VoyageTCO2Total != v.TCO2Total {
			t.Errorf("%s tCO2 total = %v, attendu %v", v.ID, got.VoyageTCO2Total, v.TCO2Total)
		}
		if got.BilledTCO2 != v.BilledTCO2 {
			t.Errorf("%s tCO2 taxé = %v, attendu %v", v.ID, got.BilledTCO2, v.BilledTCO2)
		}
	}
}

// Les totaux publiés dans la spécification. S'ils ne tombent pas au centime,
// l'implémentation est fausse — c'est le contrôle que le dossier impose avant
// toute génération.
func TestTotauxDeControle(t *testing.T) {
	g := loadGolden(t)
	var total float64
	for _, v := range g.Maritime {
		got, err := CalcMaritime(v.GT, v.NCalls)
		if err != nil {
			t.Fatal(err)
		}
		total += got.HybridUSD
	}
	const attendu = 1489616.80 // 1 316 124,00 (mai→3 août) + 173 492,80 (4→31 août)
	if math.Abs(Round(total, 2)-attendu) >= 0.005 {
		t.Fatalf("total maritime = %.2f, attendu %.2f", Round(total, 2), attendu)
	}

	var somme float64
	for _, v := range g.Totaux {
		somme += v
	}
	if math.Abs(Round(somme, 2)-attendu) >= 0.005 {
		t.Fatalf("somme des totaux du golden = %.2f, attendu %.2f", Round(somme, 2), attendu)
	}
}

// Balayage adversarial : 10 285 jauges, dont toutes les valeurs de 1 à 1 999.
// C'est là que deux implémentations d'arrondi divergent, pas sur les cas ronds.
func TestBalayageDesJauges(t *testing.T) {
	g := loadGolden(t)
	if len(g.Sweep) < 10000 {
		t.Fatalf("balayage trop court : %d", len(g.Sweep))
	}
	for _, s := range g.Sweep {
		got, err := CalcMaritime(s.GT, 1)
		if err != nil {
			t.Fatalf("GT %d: %v", s.GT, err)
		}
		if got.PerCall.FuelTonnes != s.FuelT || got.PerCall.TCO2 != s.TCO2 ||
			got.PerCall.BilledTCO2 != s.Billed || got.PerCall.USD != s.USD {
			t.Fatalf("GT %d : Go donne (%v, %v, %v, %v), Python (%v, %v, %v, %v)",
				s.GT, got.PerCall.FuelTonnes, got.PerCall.TCO2, got.PerCall.BilledTCO2, got.PerCall.USD,
				s.FuelT, s.TCO2, s.Billed, s.USD)
		}
	}
}

func TestToutesLesCombinaisonsAviation(t *testing.T) {
	g := loadGolden(t)
	for _, f := range g.Aviation {
		got, err := CalcAviation(f.Aircraft, f.Route)
		if err != nil {
			t.Fatalf("%s %s: %v", f.Aircraft, f.Route, err)
		}
		if got.TotalUSD != f.USD || got.TaxableTCO2 != f.TaxableTCO2 {
			t.Errorf("%s %s : (%v tCO2, %v USD), attendu (%v, %v)",
				f.Aircraft, f.Route, got.TaxableTCO2, got.TotalUSD, f.TaxableTCO2, f.USD)
		}
	}
}

// Une GT absente ne se devine pas : le navire doit sortir en erreur pour
// partir en résolution MasterData. L'estimer rendrait la facture indéfendable.
func TestGTManquanteRefusee(t *testing.T) {
	for _, gt := range []int{0, -1} {
		if _, err := CalcMaritime(gt, 3); err == nil {
			t.Errorf("GT %d acceptée, elle doit être refusée", gt)
		}
	}
	if _, err := CalcMaritime(5000, 0); err == nil {
		t.Error("nCalls nul accepté, il doit être refusé")
	}
}

// Le maximum toutes zones confondues neutralise les transferts mouillage↔quai.
func TestCountCalls(t *testing.T) {
	cases := []struct {
		name   string
		events []string
		want   int
	}{
		{"une escale complète", []string{"ARRIVAL", "DEPARTURE"}, 1},
		{"transfert rade↔quai compté une fois", []string{"ARRIVAL", "DEPARTURE", "ARRIVAL", "DEPARTURE"}, 2},
		{"arrivée sans départ", []string{"ARRIVAL"}, 1},
		{"plus d'arrivées que de départs", []string{"ARRIVAL", "ARRIVAL", "DEPARTURE"}, 2},
		{"plus de départs que d'arrivées", []string{"DEPARTURE", "DEPARTURE", "DEPARTURE", "ARRIVAL"}, 3},
		{"casse et espaces indifférents", []string{" arrival ", "Departure"}, 1},
		{"événements inconnus ignorés", []string{"ARRIVAL", "ENTER_ZONE", "BRUIT"}, 1},
		{"aucun mouvement", nil, 0},
	}
	for _, c := range cases {
		if got := CountCalls(c.events); got != c.want {
			t.Errorf("%s : CountCalls = %d, attendu %d", c.name, got, c.want)
		}
	}
}

// Les raisons sociales réelles portent des suffixes : l'égalité stricte n'en
// retrouvait aucune, d'où le rapprochement par sous-chaîne.
func TestIsBlocked(t *testing.T) {
	bloques := []string{
		"MORGAN NAVIGATION CO SA",
		"morgan navigation",
		"  MORGAN   NAVIGATION  CO  SA  ",
		"PETROFLEET SHIPPING LLC",
		"IRISL GROUP",
	}
	for _, n := range bloques {
		if ok, _ := IsBlocked(n); !ok {
			t.Errorf("%q devrait être bloqué", n)
		}
	}
	for _, n := range []string{"CORAL TECHNICAL SERVICES", "AMALI MARINE SERVICES LLC", ""} {
		if ok, kw := IsBlocked(n); ok {
			t.Errorf("%q bloqué à tort par %q", n, kw)
		}
	}
}

// Le cas reel qui a failli passer : l'API donne un gerant non sanctionne, et
// c'est NOTRE registre qui porte l'entite sous sanctions.
func TestIsBlockedAnyRattrapeLeRegistre(t *testing.T) {
	// MAYAR, IMO 9167057 : gerant selon VesselFinder, armateur selon notre base.
	apiManager := "SOUTH EAST WIND SHIPPING SA"
	apiOwner := "LEVANTE MARITTIMO CO"
	registre := "MORGAN NAVIGATION CO SA"

	if ok, _ := IsBlocked(apiManager); ok {
		t.Fatal("le gerant de l'API n'est pas sanctionne : le test perdrait son sens")
	}
	ok, kw := IsBlockedAny(apiManager, apiOwner, registre)
	if !ok || kw != "MORGAN NAVIGATION" {
		t.Fatalf("IsBlockedAny = (%v, %q), attendu (true, \"MORGAN NAVIGATION\")", ok, kw)
	}

	// Aucun nom sanctionne, et les valeurs vides ne doivent rien declencher.
	if ok, kw := IsBlockedAny("CORAL TECHNICAL SERVICES", "", "AMALI MARINE SERVICES LLC"); ok {
		t.Errorf("bloque a tort par %q", kw)
	}
	if ok, _ := IsBlockedAny(); ok {
		t.Error("aucun nom fourni : ne doit rien bloquer")
	}
}

func TestRatioUniversel(t *testing.T) {
	if Round(USDPerTonneFuel, 2) != 62.28 {
		t.Fatalf("ratio = %v, attendu 62.28 USD par tonne de soute", Round(USDPerTonneFuel, 2))
	}
}
