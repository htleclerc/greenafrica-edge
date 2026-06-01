package tax

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/emissions"
	"github.com/htleclerc/africgreen/backend/internal/methodologies"
)

// AirBreakdown is the air-mode breakdown (per ICAO LTO cycle).
type AirBreakdown struct {
	EmissionSource   string  `json:"emission_source"` // ICAO_EDB | MTOW_FALLBACK
	Approximate      bool    `json:"approximate"`
	CO2KgPerLTOCycle float64 `json:"co2_kg_per_lto_cycle"`
	LTOCycles        int     `json:"lto_cycles"`
	RateUSDPerTCO2   float64 `json:"rate_usd_per_tco2"`
}

type airCalculator struct {
	db  *sql.DB
	cfg *appconfig.Reader
}

func newAirCalculator(db *sql.DB, cfg *appconfig.Reader) *airCalculator {
	return &airCalculator{db: db, cfg: cfg}
}

// Calculate implements ModeCalculator for AIR (ICAO LTO).
func (a *airCalculator) Calculate(ctx context.Context, req CalculateRequest) (Result, error) {
	if req.ICAOType == "" {
		return Result{}, fmt.Errorf("air: icao_type required")
	}
	cycles := req.LTOCycles
	if cycles == 0 {
		cycles = 1
	}
	if cycles < 0 {
		return Result{}, fmt.Errorf("air: lto_cycles must be non-negative")
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

	rate := 0.0
	if req.RateOverride != nil {
		rate = *req.RateOverride
	} else {
		v, rerr := a.cfg.GetFloat(ctx, "carbon_tax.air_rate_usd_per_tco2")
		if rerr != nil {
			return Result{}, fmt.Errorf("air: rate: %w", rerr)
		}
		rate = v
	}

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
		},
	}, nil
}
