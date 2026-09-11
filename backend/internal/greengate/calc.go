// Package greengate porte le calcul des contributions carbone Green-Gate,
// méthode « v11 HYBRID », telle qu'elle a réellement produit les pro-formas
// émises. Il est le portage Go de l'implémentation de référence Python
// `docs/KB_GreenGate_ProFormas/code/calc_greengate.py`.
//
// POURQUOI CE PAQUET EXISTE. Les 86 pro-formas de la campagne du 27/08 2026
// (1 316 124,00 USD) et les 24 d'août (173 492,80 USD) n'ont PAS été calculées
// par le moteur fiscal de ce dépôt : elles sortaient d'un script Python tenu
// hors de la plateforme. Deux méthodes coexistaient donc, et rien dans le code
// ne savait reproduire les montants réellement notifiés aux armateurs. Ce
// paquet met fin à cette situation : c'est désormais ici, et seulement ici,
// que la contribution maritime et aviation se calcule.
//
// CE QUI NE SE DISCUTE PAS. Les montants correspondants sont DÉJÀ entre les
// mains de débiteurs dont deux contestent formellement par écrit. Un écart
// d'un cent suffit à décrédibiliser l'ensemble du programme. Les vecteurs de
// `calc_test.go` — dont les 110 navires des campagnes réelles — sont là pour
// faire échouer toute modification qui déplacerait un montant.
package greengate

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Constantes réglementaires et paramètres du modèle.
const (
	// RateUSD — décret ministériel MOE&CC/MWI/36/2026 du 31 mars 2026.
	RateUSD = 40.0
	// EFHFO — facteur carbone standard HFO/VLSFO, OMI MEPC.346(78).
	EFHFO = 3.114
	// Alloc — part du CO2 du voyage attribuée à l'État du port.
	//
	// Choix méthodologique défendable mais NON fondé sur un texte : il est
	// décrit dans la note d'impact, il n'est pas dans le décret. Point
	// explicitement laissé « non tranché » par la spécification.
	Alloc = 0.5

	// Modèle de consommation v11 HYBRID : fuel = GT^0.65 / 4.
	//
	// Modèle propriétaire, non publié, non adossé à une source externe. Un
	// expert mandaté par un armateur peut le contester. À documenter si une
	// contre-expertise est demandée.
	gtExponent = 0.65
	gtDivisor  = 4.0

	// AviLegs — aller + retour.
	//
	// ⚠ Ce facteur double la contribution de chaque vol et n'est PAS expliqué
	// sur la page de calcul des pro-formas déjà émises. Une question est
	// ouverte auprès de la Direction. NE PAS le modifier sans instruction
	// écrite.
	AviLegs = 2.0
)

// USDPerTonneFuel est le ratio universel, indépendant du navire :
// 3,114 × 0,5 × 40 = 62,28 USD de contribution par tonne de soute consommée.
const USDPerTonneFuel = EFHFO * Alloc * RateUSD

// Round reproduit le `round()` natif de Python — arrondi correct de la valeur
// binaire réelle, égalités au pair le plus proche.
//
// C'EST LE PIÈGE QUI FAIT ÉCHOUER LES RÉIMPLÉMENTATIONS, et il a déjà coûté.
// Une réécriture en half-up donnait pour ALAWAD1 (GT 1687, 8 escales)
// 15 596,80 USD là où la facture remise à l'armateur porte 15 593,60 USD :
// 48,735 tCO2 s'arrondit à 48,73 par la règle du pair, à 48,74 en half-up.
// 3,20 USD d'écart suffiraient à alimenter la contestation en cours.
//
// `math.Round` de Go arrondit à l'opposé de zéro et ne prend pas de nombre de
// décimales : l'utiliser ici serait faux. On passe donc par le formatage
// décimal, qui arrondit correctement depuis la valeur binaire exacte, comme le
// fait CPython.
func Round(x float64, nd int) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	v, err := strconv.ParseFloat(strconv.FormatFloat(x, 'f', nd, 64), 64)
	if err != nil {
		return x
	}
	return v
}

// PerCall détaille la contribution d'UNE escale.
type PerCall struct {
	FuelTonnes float64 `json:"fuel_t"`
	TCO2       float64 `json:"tco2"`
	BilledTCO2 float64 `json:"billed_tco2"`
	USD        float64 `json:"usd"`
}

// Maritime est la contribution d'un navire sur une période.
type Maritime struct {
	VoyageDays      float64 `json:"voyage_days"`
	VoyageFuelT     float64 `json:"voyage_fuel_t"`
	VoyageTCO2Total float64 `json:"voyage_tco2_total"`
	BilledTCO2      float64 `json:"billed_tco2"`
	HybridUSD       float64 `json:"hybrid_usd"`
	NCalls          int     `json:"n_calls"`
	PerCall         PerCall `json:"per_call"`
}

// CalcMaritime calcule la contribution d'un navire, méthode « v11 HYBRID ».
//
// gt      jauge brute (Gross Tonnage), strictement positive
// nCalls  nombre d'escales sur la période, tel que rendu par CountCalls
//
// Chaîne par escale, chaque étape arrondie AVANT la suivante :
//
//	fuel = round(GT^0.65 / 4, 1)   tonnes de fioul
//	tCO2 = round(fuel × 3,114, 2)
//	taxé = round(tCO2 × 0,5, 2)
//	USD  = round(taxé × 40, 2)
//
// puis multiplication par nCalls. L'ARRONDI PAR ESCALE PRÉCÈDE LA
// MULTIPLICATION : calculer sur le total puis arrondir donne d'autres montants.
func CalcMaritime(gt int, nCalls int) (Maritime, error) {
	if gt <= 0 {
		// Ne JAMAIS estimer une GT à partir du DWT, du type ou de la longueur :
		// la facture serait indéfendable. Le navire sort en `missing_gt` et se
		// résout par l'API VesselFinder MasterData.
		return Maritime{}, fmt.Errorf("greengate: GT manquante ou nulle — le navire doit passer par MasterData, jamais être estimé")
	}
	if nCalls <= 0 {
		return Maritime{}, fmt.Errorf("greengate: nCalls doit valoir au moins 1, reçu %d", nCalls)
	}

	fuelCall := Round(math.Pow(float64(gt), gtExponent)/gtDivisor, 1)
	tco2Call := Round(fuelCall*EFHFO, 2)
	billedCall := Round(tco2Call*Alloc, 2)
	usdCall := Round(billedCall*RateUSD, 2)

	n := float64(nCalls)
	tco2Total := Round(tco2Call*n, 2)

	return Maritime{
		VoyageDays:      14.4, // affichage seulement, hors calcul
		VoyageFuelT:     Round(fuelCall*n, 1),
		VoyageTCO2Total: tco2Total,
		BilledTCO2:      Round(tco2Total*Alloc, 2),
		HybridUSD:       Round(usdCall*n, 2),
		NCalls:          nCalls,
		PerCall:         PerCall{FuelTonnes: fuelCall, TCO2: tco2Call, BilledTCO2: billedCall, USD: usdCall},
	}, nil
}

// CountCalls rend le nombre d'escales facturables : max(#ARRIVAL, #DEPARTURE).
//
// Les zones « Berbera » et « Berbera Anchorage » sont CONFONDUES : un mouvement
// mouillage ↔ quai n'est pas une escale de plus. Une analyse du 2 septembre
// 2026 a établi que 106 des 346 mouvements bruts de mai à début août étaient
// de simples transferts — c'est ce maximum, toutes zones confondues, qui
// neutralise le double comptage. Règle vérifiée sur les 86 navires du jeu de
// référence. NE PAS la « corriger » en comptant les arrivées seules.
func CountCalls(events []string) int {
	var arrivals, departures int
	for _, e := range events {
		switch strings.ToUpper(strings.TrimSpace(e)) {
		case "ARRIVAL":
			arrivals++
		case "DEPARTURE":
			departures++
		}
	}
	if arrivals > departures {
		return arrivals
	}
	return departures
}

// Aircraft porte les facteurs d'émission d'un type d'appareil, en tCO2.
type Aircraft struct {
	LTO    float64 // cycle décollage/atterrissage
	Cruise float64 // par heure de croisière
}

// AircraftFactors — table des appareils desservant Hargeisa et Berbera.
var AircraftFactors = map[string]Aircraft{
	"B737-800": {LTO: 2.5, Cruise: 3.0},
	"B737-700": {LTO: 2.0, Cruise: 2.5},
	"A320":     {LTO: 2.5, Cruise: 3.0},
	"Q400":     {LTO: 1.0, Cruise: 1.8},
	"ATR-72":   {LTO: 0.7, Cruise: 0.6},
	"B737-F":   {LTO: 2.5, Cruise: 3.0},
}

// RouteHours — durée de route en heures.
var RouteHours = map[string]float64{
	"ADD-HGA": 1.5, "DXB-HGA": 3.5, "SHJ-HGA": 3.5, "JED-HGA": 3.0,
	"MGQ-HGA": 1.0, "ADD-BBO": 1.5, "DXB-BBO": 3.5,
}

// RouteHoursDefault s'applique à une route non répertoriée.
const RouteHoursDefault = 4.0

// Aviation est la contribution d'un vol.
type Aviation struct {
	TaxableTCO2 float64 `json:"taxable_tco2"`
	PaxUSD      float64 `json:"pax_usd"`
	CO2USD      float64 `json:"co2_usd"`
	TotalUSD    float64 `json:"total_usd"`
}

// CalcAviation calcule la contribution d'un vol :
//
//	tCO2 = LTO + heures_de_route × taux_de_croisière
//	USD  = round(tCO2 × 2,0 × 40, 2)
//
// Une route inconnue retombe sur RouteHoursDefault ; un type d'appareil
// inconnu est une erreur, car il n'existe aucun repli défendable.
func CalcAviation(aircraft, route string) (Aviation, error) {
	ac, ok := AircraftFactors[aircraft]
	if !ok {
		return Aviation{}, fmt.Errorf("greengate: type d'appareil inconnu : %q", aircraft)
	}
	hours, ok := RouteHours[route]
	if !ok {
		hours = RouteHoursDefault
	}
	tco2 := ac.LTO + hours*ac.Cruise
	usd := tco2 * AviLegs * RateUSD
	return Aviation{
		TaxableTCO2: Round(tco2, 2),
		PaxUSD:      0,
		CO2USD:      Round(usd, 2),
		TotalUSD:    Round(usd, 2),
	}, nil
}

// BlockedKeywords — entités sous sanctions : JAMAIS facturées, JAMAIS
// contactées. Cette liste ne se réduit pas.
var BlockedKeywords = []string{
	"MORGAN NAVIGATION",
	"PETROFLEET",
	"YASSIN SHIPPING",
	"BARBARA GENERAL TRADING",
	"IRISL",
	"VALFAJR",
}

// IsBlocked dit si une raison sociale relève de la liste de sanctions.
//
// Le rapprochement se fait par SOUS-CHAÎNE sur une forme normalisée, jamais
// par égalité stricte : les raisons sociales des jeux réels portent des
// suffixes variables (« MORGAN NAVIGATION CO SA »), et une comparaison exacte
// n'en retrouvait aucune.
func IsBlocked(companyName string) (bool, string) {
	norm := strings.ToUpper(strings.Join(strings.Fields(companyName), " "))
	for _, kw := range BlockedKeywords {
		if strings.Contains(norm, kw) {
			return true, kw
		}
	}
	return false, ""
}

// IsBlockedAny examine TOUTES les raisons sociales connues d'un navire et rend
// la première qui relève des sanctions.
//
// POURQUOI CETTE FORME EST LA SEULE SÛRE. L'entité sanctionnée n'occupe pas
// toujours le même rôle selon la source. MAYAR (IMO 9167057) et HAJH GHSN J
// (IMO 7607417) sont rattachés à MORGAN NAVIGATION CO SA — sanctions UN — dans
// NOTRE registre, mais l'API VesselFinder les donne sous « SOUTH EAST WIND
// SHIPPING SA » : là-bas, Morgan Navigation n'est que le gestionnaire ISM.
// Une garde qui n'interrogerait que le gérant renvoyé par l'API laisserait donc
// passer ces deux navires — et facturerait une entité sous sanctions.
//
// L'appelant doit passer tout ce qu'il a : gérant et propriétaire de l'API,
// armateur du registre, gestionnaire ISM. Les valeurs vides sont ignorées.
func IsBlockedAny(names ...string) (bool, string) {
	for _, n := range names {
		if ok, kw := IsBlocked(n); ok {
			return true, kw
		}
	}
	return false, ""
}
