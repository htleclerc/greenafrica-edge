// Package emissions implements the cascade lookup over emission_factors.
// Priority: EU_MRV (per-IMO) > IMO_CATEGORY (per category + GT range) > FALLBACK.
package emissions

import (
	"context"
	"database/sql"
	"fmt"
)

type Factor struct {
	ID            string  // UUID, for storage in transactions.emission_factor_used_id
	Source        string  // EU_MRV | IMO_CATEGORY | FALLBACK
	GramsCO2PerNM float64
}

// Lookup runs the three-tier cascade in a single SQL query ordered by source priority.
func Lookup(ctx context.Context, db *sql.DB, imo, category string, grossTonnage int) (Factor, error) {
	const q = `
		SELECT id, source::text, grams_co2_per_nm
		  FROM public.emission_factors
		 WHERE active = TRUE
		   AND (
		     (source = 'EU_MRV' AND imo_number = $1)
		     OR (source = 'IMO_CATEGORY' AND vessel_category = $2::public.vessel_category
		         AND $3 BETWEEN COALESCE(gt_min, 0) AND COALESCE(gt_max, 2147483647))
		     OR (source = 'FALLBACK')
		   )
		 ORDER BY CASE source
		            WHEN 'EU_MRV' THEN 1
		            WHEN 'IMO_CATEGORY' THEN 2
		            ELSE 3
		          END
		 LIMIT 1
	`
	var f Factor
	if err := db.QueryRowContext(ctx, q, imo, category, grossTonnage).
		Scan(&f.ID, &f.Source, &f.GramsCO2PerNM); err != nil {
		return Factor{}, fmt.Errorf("emissions lookup imo=%s cat=%s gt=%d: %w",
			imo, category, grossTonnage, err)
	}
	return f, nil
}
