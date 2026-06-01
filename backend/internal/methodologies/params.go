// Package methodologies reads versioned CO2 methodology parameters from
// public.methodologies (control-plane). Currently exposes the ICAO LTO
// MTOW-fallback coefficients used by the air tax calculator.
package methodologies

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

type mtowFallback struct {
	Slope     float64 `json:"slope_kg_co2_per_kg_mtow"`
	Intercept float64 `json:"intercept_kg"`
}

// LookupMTOWFallback returns the (slope, intercept) of the ICAO LTO MTOW-fallback
// linear model from methodologies.params (mode='AIR', code='ICAO_LTO').
// Errors if the row or the mtow_fallback params are absent (fail-closed).
func LookupMTOWFallback(ctx context.Context, db *sql.DB) (slope, intercept float64, err error) {
	const q = `
		SELECT params->'mtow_fallback'
		  FROM public.methodologies
		 WHERE mode = 'AIR' AND code = 'ICAO_LTO'
		 ORDER BY version DESC
		 LIMIT 1
	`
	var raw []byte
	if err = db.QueryRowContext(ctx, q).Scan(&raw); err != nil {
		return 0, 0, fmt.Errorf("methodologies: ICAO_LTO params: %w", err)
	}
	if raw == nil {
		return 0, 0, fmt.Errorf("methodologies: ICAO_LTO mtow_fallback params not set")
	}
	var f mtowFallback
	if err = json.Unmarshal(raw, &f); err != nil {
		return 0, 0, fmt.Errorf("methodologies: ICAO_LTO mtow_fallback unmarshal: %w", err)
	}
	return f.Slope, f.Intercept, nil
}
