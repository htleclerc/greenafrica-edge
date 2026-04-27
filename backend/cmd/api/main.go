package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/ais"
	"github.com/htleclerc/africgreen/backend/internal/alerts"
	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/config"
	"github.com/htleclerc/africgreen/backend/internal/corridor"
	"github.com/htleclerc/africgreen/backend/internal/eez"
	"github.com/htleclerc/africgreen/backend/internal/middleware"
	"github.com/htleclerc/africgreen/backend/internal/reconcile"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
	"github.com/htleclerc/africgreen/backend/internal/tax"
)

func main() {
	cfg := config.Load()

	// ── Database ───────────────────────────────────────────────────────────
	db, err := supadb.Open(cfg.SupabaseDBURL)
	if err != nil {
		log.Fatalf("[DB] open: %v", err)
	}
	defer db.Close()

	appcfg := appconfig.New(db)
	watcher := corridor.New(db, appcfg)
	tracker := eez.NewTracker(db)
	sweeper := reconcile.NewSweeper(db)

	// ── Graceful shutdown context ─────────────────────────────────────────
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	mux := http.NewServeMux()

	// Root + health
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/health", http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"africgreen-api","version":"0.2.0"}`))
	})

	// Tax
	taxHandler := tax.NewHandler(cfg, db, appcfg)
	mux.HandleFunc("POST /api/v1/tax/calculate", taxHandler.Calculate)
	mux.HandleFunc("POST /api/v1/tax/batch", taxHandler.BatchCalculate)

	// Alerts
	alertsHandler := alerts.NewHandler(db)
	mux.HandleFunc("GET /api/v1/alerts/{id}/distance-final", alertsHandler.DistanceFinal)

	// AIS (corridor + eez + originport hooks).
	// nil = originport.Watcher not yet wired (Task 10 will replace nil with real watcher).
	aisHandler := ais.NewHandler(cfg, db, watcher, tracker, nil)
	mux.HandleFunc("GET /api/v1/ais/status", aisHandler.Status)
	mux.HandleFunc("POST /api/v1/ais/start", aisHandler.Start)
	mux.HandleFunc("POST /api/v1/ais/stop", aisHandler.Stop)

	if cfg.AISStreamAPIKey != "" {
		log.Println("[AIS] API key found — auto-starting ingestion...")
		if err := aisHandler.AutoStart(); err != nil {
			log.Printf("[AIS] Auto-start failed: %v (use POST /api/v1/ais/start to retry)", err)
		}
	}

	// Reconcile sweeper
	intervalMin, err := appcfg.GetInt(ctx, "reconciliation.check_interval_min")
	if err != nil || intervalMin <= 0 {
		intervalMin = 5
	}
	go func() {
		log.Printf("[reconcile] sweeper starting, interval=%dmin", intervalMin)
		if err := sweeper.Start(ctx, time.Duration(intervalMin)*time.Minute); err != nil {
			log.Printf("[reconcile] sweeper stopped: %v", err)
		}
	}()

	// Middleware
	handler := middleware.Chain(
		mux,
		middleware.CORS(cfg.AllowedOrigins),
		middleware.Logger,
		middleware.Auth(cfg.APISecret),
	)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("[API] Listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[API] Server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("[API] Shutting down...")

	// Stop the AIS ingester first so its hook handlers (corridor, EEZ) observe
	// ctx cancellation. Bound the wait to 5s — if a hook is hung, the process
	// must still exit. The HTTP server gets its own 10s window after.
	aisShutdownCtx, aisCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := aisHandler.Shutdown(aisShutdownCtx); err != nil {
		log.Printf("[AIS] Shutdown timed out: %v (forcing exit)", err)
	}
	aisCancel()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[API] Shutdown error: %v", err)
	}
	log.Println("[API] Stopped.")
}
