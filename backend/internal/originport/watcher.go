package originport

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
)

// StaticReport is the subset of an AIS-5 ShipStaticData message that the
// origin-port detector needs.
type StaticReport struct {
	MMSI        string
	IMO         string
	VesselName  string
	Destination string
	ETA         time.Time // already decoded from MMDDHHMM by caller
	Lat         float64   // current MetaData lat (last known position)
	Lng         float64
	RecordedAt  time.Time
}

// Watcher orchestrates allow-list match → arrival_alerts vs fuzzy → proposals.
// Reads feature.ais_global_enabled and arrival.origin_port_allow_list from
// app_config (cached for 60s by appconfig.Reader).
type Watcher struct {
	db    *sql.DB
	cfg   *appconfig.Reader
	cache *Cache
}

func NewWatcher(db *sql.DB, cfg *appconfig.Reader, cache *Cache) *Watcher {
	return &Watcher{db: db, cfg: cfg, cache: cache}
}

// OnStaticData processes one ShipStaticData report. Returns the alert id on
// success path, "" otherwise (drop, propose, dedup, flag-off all return "").
func (w *Watcher) OnStaticData(ctx context.Context, r StaticReport) (string, error) {
	enabled, err := w.cfg.GetBool(ctx, "feature.ais_global_enabled")
	if err != nil {
		return "", fmt.Errorf("originport: read flag: %w", err)
	}
	if !enabled {
		return "", nil
	}
	if r.IMO == "" {
		return "", nil
	}

	// Skip if we already saw this MMSI with the same Destination recently.
	if prev, ok := w.cache.Get(r.MMSI); ok && prev.Destination == strings.ToUpper(strings.TrimSpace(r.Destination)) {
		return "", nil
	}

	allow, err := w.loadAllowList(ctx)
	if err != nil {
		return "", fmt.Errorf("originport: load allow-list: %w", err)
	}

	res := MatchDestination(r.Destination, allow)
	switch res.Kind {
	case MatchAllow:
		if w.observeOnly(ctx) {
			// Mode observation : on enregistre ce qu'on AURAIT facture, sans
			// rien declencher. Une destination declaree est une intention, pas
			// une arrivee — et personne ne sait aujourd'hui combien de navires
			// annoncent reellement Berbera ou Zeila. Une semaine de collecte
			// coute zero et repond a la question avant qu'on engage une
			// depense sur une source de donnees.
			//
			// La ligne se reconnait a fuzzy_score = 0 : une proposition floue
			// a toujours une distance d'au moins 1.
			if perr := w.insertProposal(ctx, r, res); perr != nil {
				return "", perr
			}
			w.cache.Put(r.MMSI, VesselState{IMO: r.IMO, Destination: res.Normalized})
			return "", nil
		}
		alertID, ierr := w.insertAlert(ctx, r, res)
		if ierr != nil {
			return "", ierr
		}
		w.cache.Put(r.MMSI, VesselState{IMO: r.IMO, Destination: res.Normalized})
		return alertID, nil

	case MatchPropose:
		if perr := w.insertProposal(ctx, r, res); perr != nil {
			return "", perr
		}
		// Don't cache — we want re-evaluation if Destination changes.
		return "", nil

	default: // MatchNone
		// Cache anyway to suppress re-evaluation of a known-irrelevant Destination.
		w.cache.Put(r.MMSI, VesselState{IMO: r.IMO, Destination: res.Normalized})
		return "", nil
	}
}

// observeOnly indique si une correspondance d'allow-list doit etre seulement
// enregistree au lieu de creer une alerte d'arrivee.
//
// TOUTE erreur de lecture — cle absente, base injoignable — renvoie true. Le
// defaut penche du cote qui ne facture pas : sur une taxe souveraine, un
// incident d'infrastructure ne doit jamais pouvoir emettre une pro-forma.
func (w *Watcher) observeOnly(ctx context.Context) bool {
	v, err := w.cfg.GetBool(ctx, "feature.ais_global_observe_only")
	if err != nil {
		return true
	}
	return v
}

func (w *Watcher) loadAllowList(ctx context.Context) (AllowList, error) {
	var al AllowList
	if err := w.cfg.GetJSON(ctx, "arrival.origin_port_allow_list", &al); err != nil {
		return nil, err
	}
	return al, nil
}

func (w *Watcher) insertAlert(ctx context.Context, r StaticReport, res MatchResult) (string, error) {
	var vesselID string
	if err := w.db.QueryRowContext(ctx,
		`SELECT id FROM public.vessels WHERE mmsi=$1 LIMIT 1`, r.MMSI).Scan(&vesselID); err != nil {
		if err == sql.ErrNoRows {
			return "", nil // vessel not in our DB yet — drop quietly
		}
		return "", err
	}

	var alertID string
	err := w.db.QueryRowContext(ctx, `
		INSERT INTO public.arrival_alerts
		  (vessel_id, imo_number, status, detection_source,
		   detected_lat, detected_lng, estimated_eta)
		VALUES ($1, $2, 'UNCLAIMED', 'ORIGINPORT', $3, $4, $5)
		RETURNING id
	`, vesselID, r.IMO, r.Lat, r.Lng, r.ETA).Scan(&alertID)
	if err != nil {
		// Existing partial unique idx on (vessel_id) WHERE status NOT IN
		// ('RECONCILED','CANCELLED') silently absorbs a 2nd active alert.
		if isUniqueViolation(err) {
			return "", nil
		}
		return "", fmt.Errorf("originport: insert alert: %w", err)
	}
	return alertID, nil
}

func (w *Watcher) insertProposal(ctx context.Context, r StaticReport, res MatchResult) error {
	_, err := w.db.ExecContext(ctx, `
		INSERT INTO public.destination_match_proposals
		  (mmsi, imo_number, vessel_name, raw_destination, normalized,
		   matched_port_guess, fuzzy_score, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING')
		ON CONFLICT (mmsi, normalized) WHERE status='PENDING' DO NOTHING
	`, r.MMSI, r.IMO, r.VesselName, r.Destination, res.Normalized,
		res.Port, res.FuzzyScore)
	if err != nil {
		return fmt.Errorf("originport: insert proposal: %w", err)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "23505") ||
		strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint")
}
