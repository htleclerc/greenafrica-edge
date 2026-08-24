package ais

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/htleclerc/africgreen/backend/internal/backoff"
	"github.com/htleclerc/africgreen/backend/internal/config"
	"github.com/htleclerc/africgreen/backend/internal/corridor"
	"github.com/htleclerc/africgreen/backend/internal/eez"
	"github.com/htleclerc/africgreen/backend/internal/originport"
)

// AIS message from aisstream.io. Two MessageType values are handled:
//   - "PositionReport" — Lat/Lng/SOG (existing corridor + EEZ path)
//   - "ShipStaticData" — IMO/Destination/ETA (Plan 8 origin-port detection)
type AISMessage struct {
	MessageType string `json:"MessageType"`
	MetaData    struct {
		MMSI      int     `json:"MMSI"`
		MMSIStr   string  `json:"MMSI_String"`
		ShipName  string  `json:"ShipName"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		TimeUTC   string  `json:"time_utc"`
	} `json:"MetaData"`
	Message struct {
		PositionReport *struct {
			Cog         float64 `json:"Cog"`
			Sog         float64 `json:"Sog"`
			TrueHeading int     `json:"TrueHeading"`
		} `json:"PositionReport"`
		ShipStaticData *struct {
			ImoNumber            int         `json:"ImoNumber"`
			Destination          string      `json:"Destination"`
			Eta                  AISETAField `json:"Eta"`
			CallSign             string      `json:"CallSign"`
			Type                 int         `json:"Type"`
			MaximumStaticDraught float64     `json:"MaximumStaticDraught"`
		} `json:"ShipStaticData"`
	} `json:"Message"`
}

// AISETAField mirrors aisstream.io's ETA payload (4 ints, no year).
type AISETAField struct {
	Month  int `json:"Month"`
	Day    int `json:"Day"`
	Hour   int `json:"Hour"`
	Minute int `json:"Minute"`
}

// DecodeETA turns an AIS-5 ETA (no year) into an absolute UTC time using
// "if past, roll to next year" heuristic. Returns zero time if any field
// is sentinel-invalid (Month==0, Day==0, Hour>23, Minute>59).
func DecodeETA(eta AISETAField, now time.Time) time.Time {
	if eta.Month == 0 || eta.Day == 0 || eta.Hour > 23 || eta.Minute > 59 ||
		eta.Month < 1 || eta.Month > 12 || eta.Day < 1 || eta.Day > 31 {
		return time.Time{}
	}
	year := now.UTC().Year()
	candidate := time.Date(year, time.Month(eta.Month), eta.Day,
		eta.Hour, eta.Minute, 0, 0, time.UTC)
	if candidate.Before(now.UTC()) {
		candidate = candidate.AddDate(1, 0, 0)
	}
	return candidate
}

// Ingester manages the AIS WebSocket connection(s) and writes positions to Supabase.
// Regional connection: existing bbox + PositionReport → corridor + EEZ hooks (always on).
// Global connection: 4 world quadrants + ShipStaticData → originport.Watcher (gated by feature flag).
type Ingester struct {
	cfg        *config.Config
	db         *sql.DB // nullable when tests don't need hooks
	watcher    *corridor.Watcher
	tracker    *eez.Tracker
	originport *originport.Watcher
	mu         sync.Mutex
	running    bool
	stopCh     chan struct{}
	done       chan struct{}   // closed when the run() goroutine returns; lets Wait() bound shutdown
	ctx        context.Context // hook ctx, cancelled by Stop() so in-flight corridor/eez calls unwind
	cancel     context.CancelFunc
	stats      Stats
}

type Stats struct {
	Running       bool      `json:"running"`
	StartedAt     time.Time `json:"started_at,omitempty"`
	MessagesTotal int64     `json:"messages_total"`
	LastMessageAt time.Time `json:"last_message_at,omitempty"`
	Errors        int64     `json:"errors"`

	// Health is derived, never stored. `Running` only says the goroutine is
	// alive — it stayed true for 37 days on staging with 0 message and 49 250
	// connection errors, and nothing surfaced it. A supervision field that
	// cannot go red is worse than none.
	Health       string `json:"health"`                  // ok | degraded | stopped
	HealthReason string `json:"health_reason,omitempty"` // filled when not ok
	LastError    string `json:"last_error,omitempty"`    // dernier echec de connexion

	// Recevoir n'est pas ecrire. Le 2026-08-24 la staging a tenu deux heures
	// de flux continu en n'ecrivant pas une seule position : l'app Fly n'avait
	// ni SUPABASE_URL ni SUPABASE_SERVICE_ROLE_KEY, et les quatre appels REST
	// du handler jetaient leur resultat sans un mot. Un ingesteur qui recoit
	// et n'ecrit pas doit se declarer degrade.
	PositionsWritten int64  `json:"positions_written"`
	WriteErrors      int64  `json:"write_errors"`
	LastWriteError   string `json:"last_write_error,omitempty"`
}

// staleAfter is how long the ingester may go without a single message before
// its health is reported degraded. aisstream delivers continuously in a
// covered area, so a silent minute is already suspicious; 5 min avoids
// flapping on a reconnect.
const staleAfter = 5 * time.Minute

// aisReconnect remplace l'ancien delai fixe de 5 s. La machine de production
// ouvrait ~14 400 connexions par jour vers aisstream, chacune fermee par le
// serveur une seconde apres l'abonnement (close 1006) : le tier gratuit limite
// les connexions simultanees, et staging + prod partagent la meme cle.
var aisReconnect = backoff.Policy{Min: 5 * time.Second, Max: 5 * time.Minute}

// healthyConn est la duree au-dela de laquelle une connexion est consideree
// comme ayant reellement fonctionne : le backoff repart alors de zero. Sans ce
// seuil, une connexion qui meurt au bout d'une seconde remettrait le compteur
// a plat et on retomberait sur une boucle serree.
const healthyConn = time.Minute

// postJSON envoie une ecriture PostgREST et rend une erreur exploitable. Le
// code precedent appelait http.DefaultClient.Do sans regarder ni l'erreur ni
// le statut : une URL vide, une cle absente ou un 401 passaient pour un succes.
func (ing *Ingester) postJSON(path string, payload []byte) error {
	if ing.cfg.SupabaseURL == "" || ing.cfg.SupabaseKey == "" {
		return fmt.Errorf("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absent — aucune ecriture possible")
	}
	req, err := http.NewRequest("POST", ing.cfg.SupabaseURL+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", ing.cfg.SupabaseKey)
	req.Header.Set("Authorization", "Bearer "+ing.cfg.SupabaseKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "resolution=merge-duplicates")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("%s: HTTP %d", path, resp.StatusCode)
	}
	return nil
}

// noteWriteError compte l'echec et le journalise sans inonder : le premier,
// puis un sur cent. Un flux AIS dense produirait des milliers de lignes par
// minute si on les logguait toutes, et on ne verrait plus rien.
func (ing *Ingester) noteWriteError(err error) {
	ing.mu.Lock()
	ing.stats.WriteErrors++
	ing.stats.LastWriteError = err.Error()
	n := ing.stats.WriteErrors
	ing.mu.Unlock()
	if n == 1 || n%100 == 0 {
		log.Printf("[AIS] ECRITURE EN ECHEC (%d au total): %v", n, err)
	}
}

// noteConnError enregistre un echec de connexion (compteur + dernier message)
// pour que /api/v1/ais/status puisse le montrer, au lieu d'obliger a lire les
// logs Fly.
func (ing *Ingester) noteConnError(err error) {
	ing.mu.Lock()
	ing.stats.Errors++
	ing.stats.LastError = err.Error()
	ing.mu.Unlock()
}

// NewIngesterWithDeps constructs an Ingester with db + hooks wired in.
// Positions written to Supabase will trigger corridor.Evaluate + eez.OnPosition
// using a context that Stop() cancels, so shutdown unwinds in-flight hooks.
//
// Pass nil for db/watcher/tracker/op in tests that only need the WebSocket side.
func NewIngesterWithDeps(cfg *config.Config, db *sql.DB,
	watcher *corridor.Watcher, tracker *eez.Tracker,
	op *originport.Watcher) *Ingester {
	return &Ingester{
		cfg:        cfg,
		db:         db,
		watcher:    watcher,
		tracker:    tracker,
		originport: op,
		stopCh:     make(chan struct{}),
	}
}

// Start connects to aisstream.io and begins ingestion.
func (ing *Ingester) Start() error {
	ing.mu.Lock()
	defer ing.mu.Unlock()

	if ing.running {
		return fmt.Errorf("ingester already running")
	}

	if ing.cfg.AISStreamAPIKey == "" {
		return fmt.Errorf("AISSTREAM_API_KEY not configured")
	}

	ing.running = true
	ing.stats.Running = true
	ing.stats.StartedAt = time.Now()
	ing.stopCh = make(chan struct{})
	ing.done = make(chan struct{})
	ing.ctx, ing.cancel = context.WithCancel(context.Background())

	go func() {
		defer close(ing.done)
		ing.run()
	}()
	return nil
}

// Wait blocks until the run() goroutine returns or ctx is cancelled. Use to
// bound shutdown time (e.g., 5s) so the process exits even if a hook handler
// hangs. Returns ctx.Err() on timeout, nil on clean exit.
func (ing *Ingester) Wait(ctx context.Context) error {
	ing.mu.Lock()
	done := ing.done
	ing.mu.Unlock()
	if done == nil {
		return nil
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Stop gracefully stops the ingester. Cancels the hook context so any
// in-flight corridor.Evaluate / eez.OnPosition call unwinds promptly.
func (ing *Ingester) Stop() {
	ing.mu.Lock()
	defer ing.mu.Unlock()

	if !ing.running {
		return
	}

	if ing.cancel != nil {
		ing.cancel()
	}
	close(ing.stopCh)
	ing.running = false
	ing.stats.Running = false
}

// GetStats returns current ingestion statistics.
func (ing *Ingester) GetStats() Stats {
	ing.mu.Lock()
	st := ing.stats
	ing.mu.Unlock()
	st.Health, st.HealthReason = health(st, time.Now())
	return st
}

// health derives the reported health from the raw counters. Split out from
// GetStats so it can be tested without an ingester.
func health(st Stats, now time.Time) (string, string) {
	if !st.Running {
		return "stopped", ""
	}
	if st.LastMessageAt.IsZero() {
		if st.StartedAt.IsZero() || now.Sub(st.StartedAt) < staleAfter {
			return "ok", "" // just started, nothing received yet — not a verdict
		}
		return "degraded", withLastError(fmt.Sprintf(
			"aucun message depuis le demarrage il y a %s (%d erreurs de connexion)",
			now.Sub(st.StartedAt).Truncate(time.Minute), st.Errors), st)
	}
	if st.MessagesTotal > 0 && st.PositionsWritten == 0 {
		return "degraded", withLastError(fmt.Sprintf(
			"%d messages recus, aucune position ecrite (%d echecs d'ecriture)",
			st.MessagesTotal, st.WriteErrors), st)
	}
	if d := now.Sub(st.LastMessageAt); d > staleAfter {
		return "degraded", withLastError(fmt.Sprintf(
			"dernier message il y a %s (%d erreurs de connexion)",
			d.Truncate(time.Minute), st.Errors), st)
	}
	return "ok", ""
}

// withLastError accroche le dernier echec au motif : sans lui, il faut aller
// lire les logs de l'hebergeur pour savoir POURQUOI rien n'arrive.
func withLastError(reason string, st Stats) string {
	detail := st.LastWriteError
	if detail == "" {
		detail = st.LastError
	}
	if detail == "" {
		return reason
	}
	return reason + " — dernier echec : " + detail
}

// run spawns two parallel goroutines:
//  1. Regional dynamic: existing bbox + PositionReport (always on)
//  2. Global static: 4 world quadrants + ShipStaticData (gated by feature flag, hot-reloaded every 60s)
func (ing *Ingester) run() {
	regionalDone := make(chan struct{})
	go func() {
		defer close(regionalDone)
		ing.runOne(connectRegional)
	}()

	globalDone := make(chan struct{})
	go func() {
		defer close(globalDone)
		ing.runGlobalConditional()
	}()

	<-regionalDone
	<-globalDone
}

// subscribeFn is the function called after a WebSocket dial to send the
// subscription payload (bounding boxes + message type filter).
type subscribeFn func(*Ingester, *websocket.Conn) error

// defaultRegionalBoxes couvre les routes d'approche de Berbera et Zeila, pas
// seulement leur voisinage. Une seule boite autour de la Corne ne sert a rien :
// mesure du 2026-08-24, aisstream n'a aucun recepteur terrestre dans le golfe
// d'Aden (10 min d'ecoute, zero message, contre 25 instantanes en Manche).
// L'interet est donc de voir le navire la ou il EST visible, en amont.
//
// Format aisstream : [[lat_min, lon_min], [lat_max, lon_max]].
var defaultRegionalBoxes = [][]([]float64){
	{{12, 32}, {32, 44}},   // Mer Rouge + approches de Suez
	{{0, 40}, {28, 78}},    // Golfe d'Aden, mer d'Arabie, golfe d'Oman
	{{-36, 20}, {2, 56}},   // Afrique de l'Est + canal du Mozambique (route du Cap)
	{{-12, 78}, {22, 106}}, // Ocean Indien est + approches de Malacca
}

// regionalBoxes renvoie les boites d'abonnement, lues dans app_config
// (`ais.regional_bounding_boxes`) pour qu'un elargissement soit un changement
// de configuration et non un deploiement. Toute absence ou erreur retombe sur
// le defaut : ce flux ne doit jamais s'arreter faute de configuration.
func (ing *Ingester) regionalBoxes() [][]([]float64) {
	if ing.db == nil {
		return defaultRegionalBoxes
	}
	ctx := ing.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	var raw []byte
	err := ing.db.QueryRowContext(ctx,
		`SELECT value FROM public.app_config WHERE key='ais.regional_bounding_boxes'`).Scan(&raw)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("[AIS] lecture de ais.regional_bounding_boxes: %v — repli sur le defaut", err)
		}
		return defaultRegionalBoxes
	}
	boxes, ok := parseBoxes(raw)
	if !ok {
		log.Printf("[AIS] ais.regional_bounding_boxes illisible ou mal formee — repli sur le defaut")
		return defaultRegionalBoxes
	}
	return boxes
}

// parseBoxes valide la configuration avant de s'en servir. Une boite mal
// formee envoyee a aisstream ne provoque pas d'erreur : l'abonnement est
// accepte et le flux reste simplement vide — exactement le genre de panne
// muette qu'on passe la journee a debusquer. On refuse donc en bloc et on
// retombe sur un defaut connu, plutot que d'accepter a moitie.
func parseBoxes(raw []byte) ([][]([]float64), bool) {
	var boxes [][]([]float64)
	if err := json.Unmarshal(raw, &boxes); err != nil || len(boxes) == 0 {
		return nil, false
	}
	for _, b := range boxes {
		if len(b) != 2 || len(b[0]) != 2 || len(b[1]) != 2 {
			return nil, false
		}
		latMin, lonMin, latMax, lonMax := b[0][0], b[0][1], b[1][0], b[1][1]
		if latMin < -90 || latMax > 90 || lonMin < -180 || lonMax > 180 {
			return nil, false
		}
		if latMin >= latMax || lonMin >= lonMax {
			return nil, false // coins inverses : aisstream accepte et n'envoie rien
		}
	}
	return boxes, true
}

// connectRegional sends the subscription for the regional PositionReport feed.
func connectRegional(ing *Ingester, conn *websocket.Conn) error {
	boxes := ing.regionalBoxes()
	bb := make([][]interface{}, 0, len(boxes))
	for _, b := range boxes {
		bb = append(bb, []interface{}{b[0], b[1]})
	}
	log.Printf("[AIS] abonnement regional : %d boite(s)", len(bb))
	return conn.WriteJSON(map[string]interface{}{
		"APIKey":             ing.cfg.AISStreamAPIKey,
		"BoundingBoxes":      bb,
		"FilterMessageTypes": []string{"PositionReport"},
	})
}

// connectGlobalStatic sends the subscription for global ShipStaticData.
// Uses 4 world quadrants to avoid edge cases on a single global bounding box.
func connectGlobalStatic(ing *Ingester, conn *websocket.Conn) error {
	sub := map[string]interface{}{
		"APIKey": ing.cfg.AISStreamAPIKey,
		"BoundingBoxes": [][]interface{}{
			{[]float64{-90.0, -180.0}, []float64{0.0, 0.0}},
			{[]float64{-90.0, 0.0}, []float64{0.0, 180.0}},
			{[]float64{0.0, -180.0}, []float64{90.0, 0.0}},
			{[]float64{0.0, 0.0}, []float64{90.0, 180.0}},
		},
		"FilterMessageTypes": []string{"ShipStaticData"},
	}
	return conn.WriteJSON(sub)
}

// runOne is the reconnect loop for a single subscription.
// It retries on error with a 5-second backoff, honouring stopCh for clean shutdown.
func (ing *Ingester) runOne(sub subscribeFn) {
	var wait time.Duration
	for {
		select {
		case <-ing.stopCh:
			return
		default:
			started := time.Now()
			if err := ing.connectAndRead(sub); err != nil {
				ing.noteConnError(err)
				if time.Since(started) >= healthyConn {
					wait = 0 // la connexion avait tenu : on repart du delai minimal
				}
				wait = aisReconnect.Next(wait)
				log.Printf("[AIS] Connection error: %v. Reconnecting in %s...", err, wait)
				select {
				case <-ing.stopCh:
					return
				case <-time.After(wait):
				}
			}
		}
	}
}

// runGlobalConditional manages the global ShipStaticData connection.
// It reads feature.ais_global_enabled from app_config every 60s and
// starts/stops the connection accordingly (hot-reload without process restart).
func (ing *Ingester) runGlobalConditional() {
	tick := time.NewTicker(60 * time.Second)
	defer tick.Stop()
	var globalCancel context.CancelFunc

	check := func() {
		enabled := false
		if ing.originport != nil && ing.db != nil {
			hookCtx := ing.ctx
			if hookCtx == nil {
				hookCtx = context.Background()
			}
			if v, err := readGlobalFlag(hookCtx, ing.db); err == nil {
				enabled = v
			}
		}
		if enabled && globalCancel == nil {
			ctx, cancel := context.WithCancel(ing.ctx)
			globalCancel = cancel
			go ing.runOneCtx(ctx, connectGlobalStatic)
			log.Println("[AIS] Global ShipStaticData connection: ON")
		} else if !enabled && globalCancel != nil {
			globalCancel()
			globalCancel = nil
			log.Println("[AIS] Global ShipStaticData connection: OFF")
		}
	}

	// Initial check — don't wait 60s for the first tick.
	check()

	for {
		select {
		case <-ing.stopCh:
			if globalCancel != nil {
				globalCancel()
			}
			return
		case <-tick.C:
			check()
		}
	}
}

// runOneCtx is like runOne but uses a cancellable ctx for the global connection,
// so runGlobalConditional can stop it independently of the full ingester shutdown.
func (ing *Ingester) runOneCtx(ctx context.Context, sub subscribeFn) {
	var wait time.Duration
	for {
		select {
		case <-ctx.Done():
			return
		default:
			started := time.Now()
			if err := ing.connectAndRead(sub); err != nil {
				// L'echec de la connexion globale n'etait compte nulle part :
				// elle pouvait echouer en boucle sans que /status en sache rien.
				ing.noteConnError(err)
				if time.Since(started) >= healthyConn {
					wait = 0
				}
				wait = aisReconnect.Next(wait)
				log.Printf("[AIS] Connection error (global): %v. Reconnecting in %s...", err, wait)
				select {
				case <-ctx.Done():
					return
				case <-time.After(wait):
				}
			}
		}
	}
}

// readGlobalFlag queries app_config for the feature.ais_global_enabled flag value.
func readGlobalFlag(ctx context.Context, db *sql.DB) (bool, error) {
	var raw []byte
	if err := db.QueryRowContext(ctx,
		`SELECT value FROM public.app_config
		  WHERE key='feature.ais_global_enabled'`).Scan(&raw); err != nil {
		return false, err
	}
	return string(raw) == "true", nil
}

// connectAndRead dials aisstream.io, subscribes using the provided subscribeFn,
// then reads messages in a loop dispatching by MessageType:
//   - "PositionReport" → handlePositionReport (existing corridor + EEZ path; behaviour unchanged)
//   - "ShipStaticData" → handleStaticData (originport.Watcher)
func (ing *Ingester) connectAndRead(sub subscribeFn) error {
	conn, _, err := websocket.DefaultDialer.Dial("wss://stream.aisstream.io/v0/stream", nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	if err := sub(ing, conn); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	log.Println("[AIS] Connected to aisstream.io")

	for {
		select {
		case <-ing.stopCh:
			return nil
		default:
		}

		// 5-minute read timeout — long enough that low-traffic zones don't trigger
		// constant reconnect, short enough to detect real connection drops.
		conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
		_, rawMsg, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}

		var msg AISMessage
		if err := json.Unmarshal(rawMsg, &msg); err != nil {
			continue
		}

		if msg.MetaData.MMSIStr == "" {
			continue
		}

		ing.mu.Lock()
		ing.stats.MessagesTotal++
		ing.stats.LastMessageAt = time.Now()
		ing.mu.Unlock()

		switch msg.MessageType {
		case "PositionReport":
			ing.handlePositionReport(msg)
		case "ShipStaticData":
			ing.handleStaticData(msg)
		}
	}
}

// handlePositionReport processes a PositionReport message. Preserves all side
// effects from the original connect() body: vessel upsert, position insert,
// corridor.Evaluate, eez.OnPosition.
func (ing *Ingester) handlePositionReport(msg AISMessage) {
	// Guard: skip messages with no position (same as the previous `continue` in connect loop).
	if msg.MetaData.Latitude == 0 {
		return
	}

	// Upsert vessel into Supabase
	vesselPayload, _ := json.Marshal(map[string]interface{}{
		"mmsi":              msg.MetaData.MMSIStr,
		"name":              msg.MetaData.ShipName,
		"imo_number":        "",
		"call_sign":         "",
		"flag_code":         "",
		"category":          "CARGO",
		"compliance_status": "APPROACHING",
	})
	if err := ing.postJSON("/rest/v1/vessels", vesselPayload); err != nil {
		ing.noteWriteError(fmt.Errorf("upsert navire %s: %w", msg.MetaData.MMSIStr, err))
		return
	}

	// Fetch vessel ID for position insert
	lookupURL := fmt.Sprintf("%s/rest/v1/vessels?mmsi=eq.%s&select=id&limit=1", ing.cfg.SupabaseURL, msg.MetaData.MMSIStr)
	lookupReq, _ := http.NewRequest("GET", lookupURL, nil)
	lookupReq.Header.Set("apikey", ing.cfg.SupabaseKey)
	lookupReq.Header.Set("Authorization", "Bearer "+ing.cfg.SupabaseKey)
	lookupResp, err := http.DefaultClient.Do(lookupReq)
	if err != nil {
		ing.noteWriteError(fmt.Errorf("recherche navire %s: %w", msg.MetaData.MMSIStr, err))
		return
	}
	if lookupResp.StatusCode != 200 {
		lookupResp.Body.Close()
		ing.noteWriteError(fmt.Errorf("recherche navire %s: HTTP %d", msg.MetaData.MMSIStr, lookupResp.StatusCode))
		return
	}
	var vessels []struct {
		ID string `json:"id"`
	}
	json.NewDecoder(lookupResp.Body).Decode(&vessels)
	lookupResp.Body.Close()
	if len(vessels) == 0 {
		// L'upsert vient de reussir : ne rien trouver signale une incoherence
		// (RLS, doublon de MMSI), pas un cas normal.
		ing.noteWriteError(fmt.Errorf("navire %s introuvable juste apres son upsert", msg.MetaData.MMSIStr))
		return
	}

	// Insert position
	sog := float64(0)
	heading := 0
	if msg.Message.PositionReport != nil {
		sog = msg.Message.PositionReport.Sog / 10
		heading = msg.Message.PositionReport.TrueHeading
	}
	posPayload, _ := json.Marshal(map[string]interface{}{
		"vessel_id":   vessels[0].ID,
		"lat":         msg.MetaData.Latitude,
		"lng":         msg.MetaData.Longitude,
		"heading":     heading,
		"speed_knots": sog,
		"recorded_at": msg.MetaData.TimeUTC,
	})
	if err := ing.postJSON("/rest/v1/vessel_positions", posPayload); err != nil {
		ing.noteWriteError(fmt.Errorf("insertion position %s: %w", msg.MetaData.MMSIStr, err))
		return
	}
	ing.mu.Lock()
	ing.stats.PositionsWritten++
	ing.mu.Unlock()

	// Fire corridor + EEZ hooks under the ingester's ctx so Stop() cancels
	// in-flight calls. Errors are logged but do not break ingestion — the
	// reconcile sweeper is the eventually-consistent safety net.
	hookCtx := ing.ctx
	if hookCtx == nil {
		hookCtx = context.Background()
	}
	if ing.watcher != nil {
		_, werr := ing.watcher.Evaluate(hookCtx, corridor.Position{
			VesselID:   vessels[0].ID,
			IMO:        "", // static data not in PositionReport; watcher no-ops on empty IMO.
			Lat:        msg.MetaData.Latitude,
			Lng:        msg.MetaData.Longitude,
			SpeedKnots: sog,
			RecordedAt: time.Now(),
		})
		if werr != nil {
			log.Printf("[AIS] corridor.Evaluate: %v", werr)
		}
	}
	if ing.tracker != nil {
		_, terr := ing.tracker.OnPosition(hookCtx, eez.Position{
			VesselID:   vessels[0].ID,
			Lat:        msg.MetaData.Latitude,
			Lng:        msg.MetaData.Longitude,
			RecordedAt: time.Now(),
		})
		if terr != nil {
			log.Printf("[AIS] eez.OnPosition: %v", terr)
		}
	}

	log.Printf("[AIS] %s (%s) at %.4f, %.4f — %.1f kn → Supabase ✓",
		msg.MetaData.ShipName,
		msg.MetaData.MMSIStr,
		msg.MetaData.Latitude,
		msg.MetaData.Longitude,
		sog,
	)
}

// handleStaticData processes a ShipStaticData message, forwarding it to the
// originport.Watcher for destination-based alert detection.
func (ing *Ingester) handleStaticData(msg AISMessage) {
	if ing.originport == nil || msg.Message.ShipStaticData == nil {
		return
	}
	s := msg.Message.ShipStaticData
	imo := ""
	if s.ImoNumber > 0 {
		imo = fmt.Sprintf("%d", s.ImoNumber)
	}
	hookCtx := ing.ctx
	if hookCtx == nil {
		hookCtx = context.Background()
	}
	_, err := ing.originport.OnStaticData(hookCtx, originport.StaticReport{
		MMSI:        msg.MetaData.MMSIStr,
		IMO:         imo,
		VesselName:  msg.MetaData.ShipName,
		Destination: s.Destination,
		ETA:         DecodeETA(s.Eta, time.Now().UTC()),
		Lat:         msg.MetaData.Latitude,
		Lng:         msg.MetaData.Longitude,
		RecordedAt:  time.Now(),
	})
	if err != nil {
		log.Printf("[AIS] originport.OnStaticData: %v", err)
	}
}

// ── HTTP Handler ────────────────────────────────────────────────────────────

type Handler struct {
	ingester *Ingester
}

// NewHandler wires corridor + eez + originport hooks through the ingester.
// Pass nil for db/watcher/tracker/op if you only need the WebSocket side (e.g., in tests).
// op will be replaced with a real originport.Watcher in Task 10; pass nil until then.
func NewHandler(cfg *config.Config, db *sql.DB,
	watcher *corridor.Watcher, tracker *eez.Tracker,
	op *originport.Watcher) *Handler {
	return &Handler{
		ingester: NewIngesterWithDeps(cfg, db, watcher, tracker, op),
	}
}

func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.ingester.GetStats())
}

func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	if err := h.ingester.Start(); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"started"}`))
}

func (h *Handler) Stop(w http.ResponseWriter, r *http.Request) {
	h.ingester.Stop()
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"stopped"}`))
}

// AutoStart starts the ingester programmatically (for boot-time auto-start).
func (h *Handler) AutoStart() error {
	return h.ingester.Start()
}

// Shutdown stops the ingester and waits up to ctx for the goroutine to exit.
// Use a bounded ctx (e.g., 5s) so the process exits even if a hook handler
// fails to observe ctx cancellation. Safe to call when not running.
func (h *Handler) Shutdown(ctx context.Context) error {
	h.ingester.Stop()
	return h.ingester.Wait(ctx)
}
