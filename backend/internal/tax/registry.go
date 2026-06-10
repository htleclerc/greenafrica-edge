package tax

import (
	"context"
	"database/sql"

	"github.com/htleclerc/africgreen/backend/internal/tariff"
)

// ModeCalculator computes carbon tax for one transport mode from a CalculateRequest.
type ModeCalculator interface {
	Calculate(ctx context.Context, req CalculateRequest) (Result, error)
}

// maritimeMode adapts the existing (maritime) Calculator to ModeCalculator.
type maritimeMode struct{ c *Calculator }

func (m maritimeMode) Calculate(ctx context.Context, req CalculateRequest) (Result, error) {
	asOf, err := resolveAsOf(req.AsOf)
	if err != nil {
		return Result{}, err
	}
	return m.c.Calculate(ctx, Input{
		IMO:            req.IMO,
		Category:       req.Category,
		GrossTonnage:   req.GrossTonnage,
		DistanceNM:     req.DistanceNM,
		JurisdictionID: req.JurisdictionID,
		AsOf:           asOf,
	})
}

// NewModeRegistry builds the mode→calculator dispatch map.
func NewModeRegistry(db *sql.DB, tariffs *tariff.Store) map[string]ModeCalculator {
	return map[string]ModeCalculator{
		"MARITIME": maritimeMode{c: NewCalculator(db, tariffs)},
		"AIR":      newAirCalculator(db, tariffs),
	}
}
