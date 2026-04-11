package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/ais"
	"github.com/htleclerc/africgreen/backend/internal/config"
	"github.com/htleclerc/africgreen/backend/internal/middleware"
	"github.com/htleclerc/africgreen/backend/internal/tax"
)

func main() {
	cfg := config.Load()

	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"africgreen-api","version":"0.1.0"}`))
	})

	// Tax calculation (batch)
	taxHandler := tax.NewHandler(cfg)
	mux.HandleFunc("POST /api/v1/tax/calculate", taxHandler.Calculate)
	mux.HandleFunc("POST /api/v1/tax/batch", taxHandler.BatchCalculate)

	// AIS ingestion — auto-start if API key is configured
	aisHandler := ais.NewHandler(cfg)
	mux.HandleFunc("GET /api/v1/ais/status", aisHandler.Status)
	mux.HandleFunc("POST /api/v1/ais/start", aisHandler.Start)
	mux.HandleFunc("POST /api/v1/ais/stop", aisHandler.Stop)

	if cfg.AISStreamAPIKey != "" {
		log.Println("[AIS] API key found — auto-starting ingestion...")
		if err := aisHandler.AutoStart(); err != nil {
			log.Printf("[AIS] Auto-start failed: %v (use POST /api/v1/ais/start to retry)", err)
		}
	}

	// Apply middleware
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

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("[API] Listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[API] Server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("[API] Shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[API] Shutdown error: %v", err)
	}

	log.Println("[API] Stopped.")
}
