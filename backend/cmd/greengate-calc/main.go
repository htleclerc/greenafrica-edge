// Commande greengate-calc — applique la méthode Green-Gate à un lot de navires.
//
// POURQUOI ELLE EXISTE. Le calcul doit avoir UNE seule implémentation. Les
// scripts d'émission sont en TypeScript ; les faire recalculer eux-mêmes
// créerait une troisième version de la formule après le Python de la base de
// connaissance et le Go de `internal/greengate` — et c'est précisément la
// multiplication des implémentations qui a produit des montants divergents.
// Cette commande est donc le seul point de passage : elle lit un lot, elle
// rend les montants, elle n'écrit rien.
//
// Entrée (stdin ou --in) : tableau JSON d'objets
//
//	{"imo":"7504158","name":"TRUST 1","gt":2975,
//	 "events":["ARRIVAL","DEPARTURE", …],
//	 "parties":["gérant API","propriétaire API","armateur du registre", …]}
//
// `parties` porte TOUTES les raisons sociales connues du navire : la garde
// sanctions les examine toutes, parce que l'entité sanctionnée n'occupe pas le
// même rôle selon la source.
//
// Sortie (stdout ou --out) : le même tableau, enrichi de n_calls, des montants,
// et de l'état (`billable`, `blocked`, `missing_gt`).
//
// Usage :
//
//	go run ./cmd/greengate-calc --in lot.json --out calcule.json
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/htleclerc/africgreen/backend/internal/greengate"
)

type entree struct {
	IMO    string   `json:"imo"`
	Name   string   `json:"name"`
	GT     int      `json:"gt"`
	Events []string `json:"events"`
	// NCallsIn permet de fournir un nombre d'escales DÉJÀ consolidé, pour un
	// lot dont on n'a plus les mouvements bruts. `events` prime quand il est
	// présent : mieux vaut laisser le maximum être recalculé ici que faire
	// confiance à un comptage venu d'ailleurs.
	NCallsIn int      `json:"n_calls,omitempty"`
	Parties  []string `json:"parties,omitempty"`
	// ProRef, quand le lot porte déjà ses références — cas d'un lot dont les
	// PDF ont été produits avant d'être enregistrés. Simple passe-plat : la
	// commande ne l'interprète pas, elle le rend tel quel pour que l'étape
	// d'émission n'ait pas à relire une deuxième source.
	ProRef string `json:"pro_ref,omitempty"`
}

type sortie struct {
	entree
	NCalls     int     `json:"n_calls"`
	State      string  `json:"state"` // billable | blocked | missing_gt
	BlockedBy  string  `json:"blocked_by,omitempty"`
	FuelT      float64 `json:"voyage_fuel_t,omitempty"`
	TCO2Total  float64 `json:"voyage_tco2_total,omitempty"`
	BilledTCO2 float64 `json:"billed_tco2,omitempty"`
	USD        float64 `json:"hybrid_usd,omitempty"`
	PerCallUSD float64 `json:"per_call_usd,omitempty"`
}

func main() {
	in := flag.String("in", "", "fichier JSON d'entrée (défaut : stdin)")
	out := flag.String("out", "", "fichier JSON de sortie (défaut : stdout)")
	flag.Parse()

	raw, err := lire(*in)
	if err != nil {
		fatal("lecture: %v", err)
	}
	var lot []entree
	if err := json.Unmarshal(raw, &lot); err != nil {
		fatal("JSON d'entrée illisible: %v", err)
	}

	res := make([]sortie, 0, len(lot))
	var total float64
	var nBillable, nBlocked, nMissing int

	for _, e := range lot {
		n := greengate.CountCalls(e.Events)
		if len(e.Events) == 0 {
			n = e.NCallsIn
		}
		s := sortie{entree: e, NCalls: n}

		// La garde sanctions passe AVANT le calcul : une entité bloquée n'est
		// pas facturée, et il n'y a donc aucun montant à produire pour elle.
		if ok, kw := greengate.IsBlockedAny(append(e.Parties, e.Name)...); ok {
			s.State, s.BlockedBy = "blocked", kw
			nBlocked++
			res = append(res, s)
			continue
		}

		m, err := greengate.CalcMaritime(e.GT, s.NCalls)
		if err != nil {
			s.State = "missing_gt"
			nMissing++
			res = append(res, s)
			continue
		}

		s.State = "billable"
		s.FuelT, s.TCO2Total = m.VoyageFuelT, m.VoyageTCO2Total
		s.BilledTCO2, s.USD, s.PerCallUSD = m.BilledTCO2, m.HybridUSD, m.PerCall.USD
		total += m.HybridUSD
		nBillable++
		res = append(res, s)
	}

	body, err := json.MarshalIndent(res, "", " ")
	if err != nil {
		fatal("sérialisation: %v", err)
	}
	if err := ecrire(*out, append(body, '\n')); err != nil {
		fatal("écriture: %v", err)
	}

	// Le récapitulatif part sur stderr pour ne jamais polluer le JSON de stdout.
	fmt.Fprintf(os.Stderr, "%d facturable(s) · %d bloqué(s) sanctions · %d sans jauge · TOTAL %.2f USD\n",
		nBillable, nBlocked, nMissing, greengate.Round(total, 2))
}

func lire(path string) ([]byte, error) {
	if path == "" {
		return os.ReadFile(os.Stdin.Name())
	}
	return os.ReadFile(path)
}

func ecrire(path string, b []byte) error {
	if path == "" {
		_, err := os.Stdout.Write(b)
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "greengate-calc: "+format+"\n", args...)
	os.Exit(1)
}
