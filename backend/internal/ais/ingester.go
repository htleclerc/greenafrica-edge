package ais

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/htleclerc/africgreen/backend/internal/config"
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
	cfg        *config.Config
	mu         sync.Mutex
	running    bool
	stopCh     chan struct{}
	stats      Stats
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

	// Subscribe to Somaliland EEZ bounding box
	sub := map[string]interface{}{
		"APIKey": ing.cfg.AISStreamAPIKey,
		"BoundingBoxes": [][]interface{}{
			{[]float64{9.5, 43.0}, []float64{13.5, 52.0}},
		},
	}
	if err := conn.WriteJSON(sub); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}

	log.Println("[AIS] Connected to aisstream.io — listening for vessels in Somaliland EEZ")

	for {
		select {
		case <-ing.stopCh:
			return nil
		default:
		}

		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
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

		// TODO: Write to Supabase via REST API
		// For now, just log
		log.Printf("[AIS] %s (%s) at %.4f, %.4f — %.1f kn",
			msg.MetaData.ShipName,
			msg.MetaData.MMSIStr,
			msg.MetaData.Latitude,
			msg.MetaData.Longitude,
			msg.Message.PositionReport.Sog/10,
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
