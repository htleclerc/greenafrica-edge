// Package tax computes carbon tax for a given vessel + transit distance.
// Rate is sourced from the versioned tariffs table (jurisdiction-aware, fail-closed).
// Formula: tax_USD = distance_NM × factor_g_CO2_per_NM × 1e-6 × rate_USD_per_tCO2
//
// as_of pins tariff-version resolution to a fiscal date (e.g. reconciliation
// re-pricing at the proforma's issuance date); default = today.
package tax

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/emissions"
	"github.com/htleclerc/africgreen/backend/internal/tariff"
)

type Input struct {
	IMO            string
	Category       string    // public.vessel_category enum literal
	GrossTonnage   int
	DistanceNM     float64
	JurisdictionID string
	AsOf           time.Time // fiscal date for tariff-version resolution; zero = today
}

type Breakdown struct {
	DistanceNM               float64 `json:"distance_nm"`
	EmissionsFactorGCO2PerNM float64 `json:"emissions_factor_g_co2_per_nm"`
	EmissionsFactorSource    string  `json:"emissions_factor_source"`
	EmissionsFactorID        string  `json:"emissions_factor_id"`
	RateUSDPerTCO2           float64 `json:"rate_usd_per_tco2"`
	TariffID                 string  `json:"tariff_id"`
	JurisdictionID           string  `json:"jurisdiction_id"`
	Currency                 string  `json:"currency"`
}

type Result struct {
	TCO2      float64 `json:"tco2"`
	USDAmount float64 `json:"usd_amount"`
	Breakdown any     `json:"breakdown"`
}

type Calculator struct {
	db      *sql.DB
	tariffs *tariff.Store
}

func NewCalculator(db *sql.DB, tariffs *tariff.Store) *Calculator {
	return &Calculator{db: db, tariffs: tariffs}
}

func (c *Calculator) Calculate(ctx context.Context, in Input) (Result, error) {
	if in.DistanceNM < 0 {
		return Result{}, fmt.Errorf("distance must be non-negative")
	}

	f, err := emissions.Lookup(ctx, c.db, in.IMO, in.Category, in.GrossTonnage)
	if err != nil {
		return Result{}, fmt.Errorf("tax: factor lookup: %w", err)
	}

	at := in.AsOf
	if at.IsZero() {
		at = time.Now()
	}

	t, terr := c.tariffs.Lookup(ctx, in.JurisdictionID, "MARITIME", in.Category, at)
	if terr != nil {
		return Result{}, fmt.Errorf("tax: %w", terr)
	}
	rate, tariffID, currency := t.RatePerTCO2, t.ID, t.Currency

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
			TariffID:                 tariffID,
			JurisdictionID:           in.JurisdictionID,
			Currency:                 currency,
		},
	}, nil
}
