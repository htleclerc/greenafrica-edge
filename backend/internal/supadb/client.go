// Package supadb holds the single sql.DB connection factory used by every
// domain package that needs to read or write Supabase Postgres directly.
package supadb

import (
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// Open returns a *sql.DB connected to the given postgres URL.
// The pool is configured conservatively (5 conns) because the Go backend
// is a single-replica long-running service; if we scale horizontally we
// will revisit the pool size.
func Open(url string) (*sql.DB, error) {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return nil, fmt.Errorf("supadb open: %w", err)
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	return db, nil
}
