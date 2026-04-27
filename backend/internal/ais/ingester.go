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
	done       chan struct{}       // closed when the run() goroutine returns; lets Wait() bound shutdown
	ctx        context.Context    // hook ctx, cancelled by Stop() so in-flight corridor/eez calls unwind
	cancel     context.CancelFunc
	stats      Stats
}

type Stats struct {
	Running       bool      `json:"running"`
	StartedAt     time.Time `json:"started_at,omitempty"`
	MessagesTotal int64     `json:"messages_total"`
	LastMessageAt time.Time `json:"last_message_at,omitempty"`
	Errors        int64     `json:"errors"`
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
	defer ing.mu.Unlock()
	return ing.stats
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
type subscribeFn func(*websocket.Conn, *config.Config) error

// connectRegional sends the subscription for the existing regional PositionReport feed.
// Covers Red Sea + Gulf of Aden + Arabian Sea + NW Indian Ocean (DEBUG bbox).
func connectRegional(conn *websocket.Conn, cfg *config.Config) error {
	sub := map[string]interface{}{
		"APIKey": cfg.AISStreamAPIKey,
		"BoundingBoxes": [][]interface{}{
			{[]float64{5.0, 40.0}, []float64{25.0, 75.0}},
		},
		// Filter to position reports only (skip static-only updates)
		"FilterMessageTypes": []string{"PositionReport"},
	}
	return conn.WriteJSON(sub)
}

// connectGlobalStatic sends the subscription for global ShipStaticData.
// Uses 4 world quadrants to avoid edge cases on a single global bounding box.
func connectGlobalStatic(conn *websocket.Conn, cfg *config.Config) error {
	sub := map[string]interface{}{
		"APIKey": cfg.AISStreamAPIKey,
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
	for {
		select {
		case <-ing.stopCh:
			return
		default:
			if err := ing.connectAndRead(sub); err != nil {
				log.Printf("[AIS] Connection error: %v. Reconnecting in 5s...", err)
				ing.mu.Lock()
				ing.stats.Errors++
				ing.mu.Unlock()
				select {
				case <-ing.stopCh:
					return
				case <-time.After(5 * time.Second):
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
	for {
		select {
		case <-ctx.Done():
			return
		default:
			if err := ing.connectAndRead(sub); err != nil {
				log.Printf("[AIS] Connection error (global): %v. Reconnecting in 5s...", err)
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Second):
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

	if err := sub(conn, ing.cfg); err != nil {
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
	req, _ := http.NewRequest("POST", ing.cfg.SupabaseURL+"/rest/v1/vessels", bytes.NewReader(vesselPayload))
	req.Header.Set("apikey", ing.cfg.SupabaseKey)
	req.Header.Set("Authorization", "Bearer "+ing.cfg.SupabaseKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "resolution=merge-duplicates")
	http.DefaultClient.Do(req)

	// Fetch vessel ID for position insert
	lookupURL := fmt.Sprintf("%s/rest/v1/vessels?mmsi=eq.%s&select=id&limit=1", ing.cfg.SupabaseURL, msg.MetaData.MMSIStr)
	lookupReq, _ := http.NewRequest("GET", lookupURL, nil)
	lookupReq.Header.Set("apikey", ing.cfg.SupabaseKey)
	lookupReq.Header.Set("Authorization", "Bearer "+ing.cfg.SupabaseKey)
	lookupResp, err := http.DefaultClient.Do(lookupReq)
	if err != nil || lookupResp.StatusCode != 200 {
		return
	}
	var vessels []struct{ ID string `json:"id"` }
	json.NewDecoder(lookupResp.Body).Decode(&vessels)
	lookupResp.Body.Close()
	if len(vessels) == 0 {
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
	posReq, _ := http.NewRequest("POST", ing.cfg.SupabaseURL+"/rest/v1/vessel_positions", bytes.NewReader(posPayload))
	posReq.Header.Set("apikey", ing.cfg.SupabaseKey)
	posReq.Header.Set("Authorization", "Bearer "+ing.cfg.SupabaseKey)
	posReq.Header.Set("Content-Type", "application/json")
	http.DefaultClient.Do(posReq)

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
