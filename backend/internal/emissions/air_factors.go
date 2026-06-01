package emissions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// AirFactor is one row of air_emission_factors (CO2 per ICAO LTO cycle).
type AirFactor struct {
	ID               string
	Source           string
	CO2KgPerLTOCycle float64
}

// LookupAir resolves an air emission factor by aircraft type. It prefers an exact
// (icao_type, engine_type) match, then any row for the icao_type, then most-recent
// effective_from. A type with no row returns found=false (no error) so the caller
// can apply the MTOW fallback.
func LookupAir(ctx context.Context, db *sql.DB, icaoType, engineType string) (AirFactor, bool, error) {
	const q = `
		SELECT id, COALESCE(source, ''), co2_kg_per_lto_cycle
		  FROM public.air_emission_factors
		 WHERE icao_type = $1
		 ORDER BY CASE WHEN $2 <> '' AND engine_type = $2 THEN 0 ELSE 1 END,
		          effective_from DESC
		 LIMIT 1
	`
	var f AirFactor
	err := db.QueryRowContext(ctx, q, icaoType, engineType).
		Scan(&f.ID, &f.Source, &f.CO2KgPerLTOCycle)
	if errors.Is(err, sql.ErrNoRows) {
		return AirFactor{}, false, nil
	}
	if err != nil {
		return AirFactor{}, false, fmt.Errorf("air emissions lookup icao=%s engine=%s: %w", icaoType, engineType, err)
	}
	return f, true, nil
}
