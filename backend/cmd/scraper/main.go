// Equasis scraper worker (Plan 7 v0 scaffold).
//
// Polls pgmq.scrape_queue, fetches HTML for each IMO, parses it through
// internal/equasis, and writes proposals into equasis_scrape_proposals.
//
// Two fetchers, selected by EQUASIS_FETCHER env (default "fixture"):
//   - "fixture" → reads backend/testdata/equasis/<imo>.html from disk
//   - "http"    → stub that errors. Real Equasis access requires legal
//     sign-off, session auth, and a CAPTCHA strategy. The
//     wiring is here so flipping that on is a one-day change.
//
// Gated by feature.equasis_scraper_enabled. When OFF, the loop sleeps
// 30s between checks and never pops messages.
//
// Run locally:
//
//	cd backend && go run ./cmd/scraper
//
// Required env: SUPABASE_DB_URL (defaults to local supabase). Optional
// env: EQUASIS_FETCHER, EQUASIS_FIXTURES_DIR (overrides ../testdata/equasis).
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/backoff"
	"github.com/htleclerc/africgreen/backend/internal/config"
	"github.com/htleclerc/africgreen/backend/internal/equasis"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

const (
	queueName            = "scrape_queue"
	visibilityTimeoutSec = 30
	pollIdleDelay        = 5 * time.Second
	pollDisabledDelay    = 30 * time.Second
	healthAddr           = ":8081"
)

// Backoff applique a TOUTE erreur DB (lecture du drapeau ou pop de la file).
// Sans lui, une coupure fait reconnecter le worker toutes les 30s
// indefiniment, ce qui arme le disjoncteur de Supavisor (ECIRCUITBREAKER) et
// bloque alors les connexions legitimes du reste de la stack. Meme politique
// que l'ingesteur AIS, cf internal/backoff.
var dbBackoff = backoff.Policy{Min: 5 * time.Second, Max: 5 * time.Minute}

// Fetcher returns Equasis HTML for an IMO number.
type Fetcher interface {
	Fetch(imo string) (string, error)
	// Source identifier written to equasis_scrape_proposals.source.
	Source() string
}

func main() {
	cfg := config.Load()

	db, err := supadb.Open(cfg.SupabaseDBURL)
	if err != nil {
		log.Fatalf("[scraper] db open: %v", err)
	}
	defer db.Close()

	appcfg := appconfig.New(db)

	fetcher := selectFetcher()
	log.Printf("[scraper] fetcher = %s", fetcher.Source())

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go startHealth(ctx)

	log.Println("[scraper] entering main loop")
	var wait time.Duration
	for {
		select {
		case <-ctx.Done():
			log.Println("[scraper] shutting down")
			return
		default:
		}

		enabled, err := appcfg.GetBool(ctx, "feature.equasis_scraper_enabled")
		if err != nil {
			wait = dbBackoff.Next(wait)
			log.Printf("[scraper] feature flag read failed: %v — assuming OFF, retry in %s", err, wait)
			sleepCtx(ctx, wait)
			continue
		}
		wait = 0
		if !enabled {
			sleepCtx(ctx, pollDisabledDelay)
			continue
		}

		processed, err := pollOnce(ctx, db, fetcher)
		if err != nil {
			wait = dbBackoff.Next(wait)
			log.Printf("[scraper] poll: %v — retry in %s", err, wait)
			sleepCtx(ctx, wait)
			continue
		}
		if !processed {
			sleepCtx(ctx, pollIdleDelay)
		}
	}
}

// pollOnce pops at most one message, processes it, and returns true if
// work was done. Errors are returned for the caller to log; the function
// itself does NOT retry.
func pollOnce(ctx context.Context, db *sql.DB, fetcher Fetcher) (bool, error) {
	msg, err := popMessage(ctx, db)
	if err != nil {
		return false, fmt.Errorf("pop: %w", err)
	}
	if msg == nil {
		return false, nil
	}

	imo := msg.IMO
	log.Printf("[scraper] msg %d: imo=%s", msg.MsgID, imo)

	html, err := fetcher.Fetch(imo)
	if err != nil {
		// Specific errors are logged but ack the message — retrying a
		// missing fixture or a CAPTCHA-walled page won't help.
		log.Printf("[scraper] fetch %s failed: %v — ack and skip", imo, err)
		ack(ctx, db, msg.MsgID, imo)
		return true, nil
	}

	prop, perr := equasis.Parse(html)
	if errors.Is(perr, equasis.ErrCaptcha) {
		log.Printf("[scraper] %s: captcha wall, ack and skip", imo)
		ack(ctx, db, msg.MsgID, imo)
		return true, nil
	}
	if errors.Is(perr, equasis.ErrIMONotFound) {
		log.Printf("[scraper] %s: vessel not found, ack and skip", imo)
		ack(ctx, db, msg.MsgID, imo)
		return true, nil
	}
	if perr != nil {
		// Unknown parser error — re-deliver, the page might transiently differ
		log.Printf("[scraper] %s: parse failed: %v — leaving for retry", imo, perr)
		return true, nil
	}

	if err := insertProposal(ctx, db, imo, prop, fetcher.Source()); err != nil {
		log.Printf("[scraper] %s: insert failed: %v — leaving for retry", imo, err)
		return true, nil
	}
	ack(ctx, db, msg.MsgID, imo)
	log.Printf("[scraper] %s: proposal inserted", imo)
	return true, nil
}

// ── pgmq wrappers ──────────────────────────────────────────────────────────

type queueMsg struct {
	MsgID int64
	IMO   string
}

func popMessage(ctx context.Context, db *sql.DB) (*queueMsg, error) {
	var msgID sql.NullInt64
	var raw sql.NullString
	err := db.QueryRowContext(ctx,
		`SELECT msg_id, message::text FROM pgmq.read($1, $2, 1)`,
		queueName, visibilityTimeoutSec,
	).Scan(&msgID, &raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !msgID.Valid {
		return nil, nil
	}
	var payload struct {
		IMO string `json:"imo"`
	}
	if err := json.Unmarshal([]byte(raw.String), &payload); err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}
	return &queueMsg{MsgID: msgID.Int64, IMO: payload.IMO}, nil
}

// ack archives the message and logs loudly on failure. A silently dropped
// ack means the message is redelivered forever and every retry re-inserts a
// proposal: that is exactly how 425k duplicate fixture rows accumulated.
func ack(ctx context.Context, db *sql.DB, msgID int64, imo string) {
	if err := ackMessage(ctx, db, msgID); err != nil {
		log.Printf("[scraper] ACK FAILED msg=%d imo=%s: %v — le message sera redelivre et redouble les propositions", msgID, imo, err)
	}
}

func ackMessage(ctx context.Context, db *sql.DB, msgID int64) error {
	// Les casts sont obligatoires : pgmq.archive a deux surcharges
	// (bigint et bigint[]) et pgx envoie des parametres non types, d'ou
	// « function pgmq.archive(unknown, unknown) is not unique ».
	_, err := db.ExecContext(ctx,
		`SELECT pgmq.archive($1::text, $2::bigint)`, queueName, msgID)
	return err
}

func insertProposal(ctx context.Context, db *sql.DB, imo string, p equasis.Proposal, source string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO public.equasis_scrape_proposals
		   (imo_number, proposed_owner_name, proposed_manager, proposed_email, proposed_country, source)
		 VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), $6)`,
		imo, p.OwnerName, p.Manager, p.Email, p.Country, source,
	)
	return err
}

// ── Fetchers ───────────────────────────────────────────────────────────────

func selectFetcher() Fetcher {
	switch os.Getenv("EQUASIS_FETCHER") {
	case "http":
		return &httpFetcher{}
	default:
		dir := os.Getenv("EQUASIS_FIXTURES_DIR")
		if dir == "" {
			dir = filepath.Join("testdata", "equasis")
		}
		return &fixtureFetcher{dir: dir}
	}
}

type fixtureFetcher struct{ dir string }

func (f *fixtureFetcher) Source() string { return "fixture" }
func (f *fixtureFetcher) Fetch(imo string) (string, error) {
	path := filepath.Join(f.dir, imo+".html")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("fixture not found for IMO %s at %s: %w", imo, path, err)
	}
	return string(data), nil
}

type httpFetcher struct{}

func (h *httpFetcher) Source() string { return "scraper" }
func (h *httpFetcher) Fetch(_ string) (string, error) {
	return "", errors.New("HTTP fetcher disabled — needs legal sign-off + session auth + captcha strategy")
}

// ── Health endpoint ────────────────────────────────────────────────────────

func startHealth(ctx context.Context) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"equasis-scraper"}`))
	})
	srv := &http.Server{
		Addr:         healthAddr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}
	go func() {
		log.Printf("[scraper] health on %s", healthAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[scraper] health err: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

// sleepCtx sleeps for d unless ctx cancels first.
func sleepCtx(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
