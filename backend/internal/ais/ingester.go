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
)

// AIS message from aisstream.io
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
	} `json:"Message"`
}

// Ingester manages the AIS WebSocket connection and writes positions to Supabase.
type Ingester struct {
	cfg     *config.Config
	db      *sql.DB // nullable for backward compat
	watcher *corridor.Watcher
	tracker *eez.Tracker
	mu      sync.Mutex
	running bool
	stopCh  chan struct{}
	stats   Stats
}

type Stats struct {
	Running       bool      `json:"running"`
	StartedAt     time.Time `json:"started_at,omitempty"`
	MessagesTotal int64     `json:"messages_total"`
	LastMessageAt time.Time `json:"last_message_at,omitempty"`
	Errors        int64     `json:"errors"`
}

func NewIngester(cfg *config.Config) *Ingester {
	return &Ingester{
		cfg:    cfg,
		stopCh: make(chan struct{}),
	}
}

// NewIngesterWithDeps constructs an Ingester with db + hooks wired in.
// Positions written to Supabase will trigger corridor.Evaluate + eez.OnPosition.
func NewIngesterWithDeps(cfg *config.Config, db *sql.DB,
	watcher *corridor.Watcher, tracker *eez.Tracker) *Ingester {
	return &Ingester{
		cfg:     cfg,
		db:      db,
		watcher: watcher,
		tracker: tracker,
		stopCh:  make(chan struct{}),
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

	go ing.run()
	return nil
}

// Stop gracefully stops the ingester.
func (ing *Ingester) Stop() {
	ing.mu.Lock()
	defer ing.mu.Unlock()

	if !ing.running {
		return
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

func (ing *Ingester) run() {
	for {
		select {
		case <-ing.stopCh:
			return
		default:
			if err := ing.connect(); err != nil {
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

func (ing *Ingester) connect() error {
	conn, _, err := websocket.DefaultDialer.Dial("wss://stream.aisstream.io/v0/stream", nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	// DEBUG MODE: wide bounding box to verify API key + connectivity.
	// Covers Red Sea + Gulf of Aden + Arabian Sea + NW Indian Ocean.
	// TODO: restrict back to Somaliland EEZ once first messages confirmed.
	sub := map[string]interface{}{
		"APIKey": ing.cfg.AISStreamAPIKey,
		"BoundingBoxes": [][]interface{}{
			{[]float64{5.0, 40.0}, []float64{25.0, 75.0}},
		},
		// Filter to position reports only (skip static-only updates)
		"FilterMessageTypes": []string{"PositionReport"},
	}
	if err := conn.WriteJSON(sub); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}

	log.Println("[AIS] Connected to aisstream.io — DEBUG bbox (Red Sea + Gulf of Aden + Arabian Sea)")

	for {
		select {
		case <-ing.stopCh:
			return nil
		default:
		}

		// 5-minute read timeout — long enough that low-traffic zones don't trigger
		// constant reconnect, short enough to detect real connection drops
		conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
		_, rawMsg, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}

		var msg AISMessage
		if err := json.Unmarshal(rawMsg, &msg); err != nil {
			continue
		}

		if msg.MetaData.MMSIStr == "" || msg.MetaData.Latitude == 0 {
			continue
		}

		ing.mu.Lock()
		ing.stats.MessagesTotal++
		ing.stats.LastMessageAt = time.Now()
		ing.mu.Unlock()

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
			continue
		}
		var vessels []struct{ ID string `json:"id"` }
		json.NewDecoder(lookupResp.Body).Decode(&vessels)
		lookupResp.Body.Close()
		if len(vessels) == 0 {
			continue
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

		// Fire corridor + EEZ hooks. Errors are logged but do not break ingestion;
		// the reconcile sweeper is the eventually-consistent safety net.
		if ing.watcher != nil {
			ctx := context.Background()
			_, werr := ing.watcher.Evaluate(ctx, corridor.Position{
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
			ctx := context.Background()
			_, terr := ing.tracker.OnPosition(ctx, eez.Position{
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
}

// ── HTTP Handler ────────────────────────────────────────────────────────────

type Handler struct {
	ingester *Ingester
}

func NewHandler(cfg *config.Config) *Handler {
	return &Handler{
		ingester: NewIngester(cfg),
	}
}

// NewHandlerWithDeps wires corridor + eez hooks through the ingester.
func NewHandlerWithDeps(cfg *config.Config, db *sql.DB,
	watcher *corridor.Watcher, tracker *eez.Tracker) *Handler {
	return &Handler{
		ingester: NewIngesterWithDeps(cfg, db, watcher, tracker),
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
