// Package tax computes carbon tax for a given vessel + transit distance.
// Formula: tax_USD = distance_NM × factor_g_CO2_per_NM × 1e-6 × rate_USD_per_tCO2
package tax

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/emissions"
)

type Input struct {
	IMO          string
	Category     string // public.vessel_category enum literal
	GrossTonnage int
	DistanceNM   float64
	RateOverride *float64 // optional: if nil, read app_config
}

type Breakdown struct {
	DistanceNM               float64 `json:"distance_nm"`
	EmissionsFactorGCO2PerNM float64 `json:"emissions_factor_g_co2_per_nm"`
	EmissionsFactorSource    string  `json:"emissions_factor_source"`
	EmissionsFactorID        string  `json:"emissions_factor_id"`
	RateUSDPerTCO2           float64 `json:"rate_usd_per_tco2"`
}

type Result struct {
	TCO2      float64 `json:"tco2"`
	USDAmount float64 `json:"usd_amount"`
	Breakdown any     `json:"breakdown"`
}

type Calculator struct {
	db  *sql.DB
	cfg *appconfig.Reader
}

func NewCalculator(db *sql.DB, cfg *appconfig.Reader) *Calculator {
	return &Calculator{db: db, cfg: cfg}
}

func (c *Calculator) Calculate(ctx context.Context, in Input) (Result, error) {
	if in.DistanceNM < 0 {
		return Result{}, fmt.Errorf("distance must be non-negative")
	}

	f, err := emissions.Lookup(ctx, c.db, in.IMO, in.Category, in.GrossTonnage)
	if err != nil {
		return Result{}, fmt.Errorf("tax: factor lookup: %w", err)
	}

	rate := 0.0
	if in.RateOverride != nil {
		rate = *in.RateOverride
	} else {
		v, err := c.cfg.GetFloat(ctx, "carbon_tax.rate_usd_per_tco2")
		if err != nil {
			return Result{}, fmt.Errorf("tax: rate: %w", err)
		}
		rate = v
	}

	tco2 := in.DistanceNM * f.GramsCO2PerNM / 1e6
	usd := tco2 * rate

	return Result{
		TCO2:      tco2,
		USDAmount: usd,
		Breakdown: Breakdown{
			DistanceNM:               in.DistanceNM,
			EmissionsFactorGCO2PerNM: f.GramsCO2PerNM,
			EmissionsFactorSource:    f.Source,
			EmissionsFactorID:        f.ID,
			RateUSDPerTCO2:           rate,
		},
	}, nil
}

// ModeCalculator computes carbon tax for one transport mode from a CalculateRequest.
type ModeCalculator interface {
	Calculate(ctx context.Context, req CalculateRequest) (Result, error)
}

// maritimeMode adapts the existing (maritime) Calculator to ModeCalculator.
type maritimeMode struct{ c *Calculator }

func (m maritimeMode) Calculate(ctx context.Context, req CalculateRequest) (Result, error) {
	return m.c.Calculate(ctx, Input{
		IMO:          req.IMO,
		Category:     req.Category,
		GrossTonnage: req.GrossTonnage,
		DistanceNM:   req.DistanceNM,
		RateOverride: req.RateOverride,
	})
}

// NewModeRegistry builds the mode→calculator dispatch map.
func NewModeRegistry(db *sql.DB, cfg *appconfig.Reader) map[string]ModeCalculator {
	return map[string]ModeCalculator{
		"MARITIME": maritimeMode{c: NewCalculator(db, cfg)},
		"AIR":      newAirCalculator(db, cfg),
	}
}
