package tax

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/htleclerc/africgreen/backend/internal/emissions"
	"github.com/htleclerc/africgreen/backend/internal/methodologies"
	"github.com/htleclerc/africgreen/backend/internal/tariff"
)

// AirBreakdown is the air-mode breakdown (per ICAO LTO cycle).
type AirBreakdown struct {
	EmissionSource   string  `json:"emission_source"` // ICAO_EDB | MTOW_FALLBACK
	Approximate      bool    `json:"approximate"`
	CO2KgPerLTOCycle float64 `json:"co2_kg_per_lto_cycle"`
	LTOCycles        int     `json:"lto_cycles"`
	RateUSDPerTCO2   float64 `json:"rate_usd_per_tco2"`
	TariffID         string  `json:"tariff_id"`
	JurisdictionID   string  `json:"jurisdiction_id"`
	Currency         string  `json:"currency"`
}

type airCalculator struct {
	db      *sql.DB
	tariffs *tariff.Store
}

func newAirCalculator(db *sql.DB, tariffs *tariff.Store) *airCalculator {
	return &airCalculator{db: db, tariffs: tariffs}
}

// Calculate implements ModeCalculator for AIR (ICAO LTO).
func (a *airCalculator) Calculate(ctx context.Context, req CalculateRequest) (Result, error) {
	if req.ICAOType == "" {
		return Result{}, fmt.Errorf("air: icao_type required")
	}
	cycles := 1
	if req.LTOCycles != nil {
		cycles = *req.LTOCycles
	}
	if cycles <= 0 {
		return Result{}, fmt.Errorf("air: lto_cycles must be positive")
	}

	co2PerLTO := 0.0
	source := ""
	approximate := false

	f, found, err := emissions.LookupAir(ctx, a.db, req.ICAOType, req.EngineType)
	if err != nil {
		return Result{}, fmt.Errorf("air: factor lookup: %w", err)
	}
	if found {
		co2PerLTO = f.CO2KgPerLTOCycle
		source = "ICAO_EDB"
	} else {
		if req.MTOWKg <= 0 {
			return Result{}, fmt.Errorf("air: no emission factor for %q and mtow_kg<=0; cannot estimate", req.ICAOType)
		}
		slope, intercept, perr := methodologies.LookupMTOWFallback(ctx, a.db)
		if perr != nil {
			return Result{}, fmt.Errorf("air: mtow fallback: %w", perr)
		}
		co2PerLTO = slope*float64(req.MTOWKg) + intercept
		source = "MTOW_FALLBACK"
		approximate = true
	}

	at, err := resolveAsOf(req.AsOf)
	if err != nil {
		return Result{}, fmt.Errorf("air: invalid as_of: %w", err)
	}

	t, terr := a.tariffs.Lookup(ctx, req.JurisdictionID, "AIR", req.ICAOType, at)
	if terr != nil {
		return Result{}, fmt.Errorf("air: %w", terr)
	}
	rate, tariffID, currency := t.RatePerTCO2, t.ID, t.Currency

	tco2 := co2PerLTO * float64(cycles) / 1000.0
	usd := tco2 * rate

	return Result{
		TCO2:      tco2,
		USDAmount: usd,
		Breakdown: AirBreakdown{
			EmissionSource:   source,
			Approximate:      approximate,
			CO2KgPerLTOCycle: co2PerLTO,
			LTOCycles:        cycles,
			RateUSDPerTCO2:   rate,
			TariffID:         tariffID,
			JurisdictionID:   req.JurisdictionID,
			Currency:         currency,
		},
	}, nil
}
