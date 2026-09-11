package greengate

import (
	"encoding/json"
	"net/http"
)

// Handler expose le calcul Green-Gate en HTTP.
//
// Il est délibérément SANS base de données et sans tarif versionné : la
// méthode v11 HYBRID ne dépend d'aucun paramètre stocké, seulement de la
// jauge, du nombre d'escales et des constantes du décret. Y brancher une
// lecture de configuration rouvrirait la porte à des montants qui changent
// sans qu'on l'ait décidé — or ces montants sont déjà notifiés.
type Handler struct{}

// NewHandler construit le handler.
func NewHandler() *Handler { return &Handler{} }

// CalculateRequest — corps de POST /api/v1/greengate/calculate.
type CalculateRequest struct {
	// Mode vaut "MARITIME" (défaut) ou "AVIATION".
	Mode string `json:"mode,omitempty"`

	// Maritime.
	GrossTonnage int `json:"gross_tonnage,omitempty"`
	// NCalls, le nombre d'escales déjà consolidé. Ignoré si Events est fourni.
	NCalls int `json:"n_calls,omitempty"`
	// Events, les mouvements bruts ("ARRIVAL"/"DEPARTURE") d'un même navire sur
	// la période, toutes zones confondues. Quand il est présent, le serveur
	// applique lui-même max(#ARRIVAL, #DEPARTURE) — c'est la forme à préférer,
	// puisqu'elle empêche l'appelant de compter les transferts mouillage↔quai
	// deux fois.
	Events []string `json:"events,omitempty"`

	// Aviation.
	Aircraft string `json:"aircraft,omitempty"`
	Route    string `json:"route,omitempty"`
}

// CalculateResponse — réponse, une seule branche renseignée selon le mode.
type CalculateResponse struct {
	Mode     string    `json:"mode"`
	Maritime *Maritime `json:"maritime,omitempty"`
	Aviation *Aviation `json:"aviation,omitempty"`
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// Calculate applique la méthode Green-Gate.
// POST /api/v1/greengate/calculate
func (h *Handler) Calculate(w http.ResponseWriter, r *http.Request) {
	var req CalculateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "corps JSON illisible")
		return
	}

	mode := req.Mode
	if mode == "" {
		mode = "MARITIME"
	}

	resp := CalculateResponse{Mode: mode}
	switch mode {
	case "MARITIME":
		n := req.NCalls
		if len(req.Events) > 0 {
			n = CountCalls(req.Events)
		}
		res, err := CalcMaritime(req.GrossTonnage, n)
		if err != nil {
			// 422 et non 400 : la requête est bien formée, c'est la donnée qui
			// manque. L'appelant doit résoudre la jauge via MasterData, pas
			// corriger sa syntaxe.
			writeErr(w, http.StatusUnprocessableEntity, err.Error())
			return
		}
		resp.Maritime = &res

	case "AVIATION":
		res, err := CalcAviation(req.Aircraft, req.Route)
		if err != nil {
			writeErr(w, http.StatusUnprocessableEntity, err.Error())
			return
		}
		resp.Aviation = &res

	default:
		writeErr(w, http.StatusBadRequest, "mode inconnu : attendu MARITIME ou AVIATION")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
