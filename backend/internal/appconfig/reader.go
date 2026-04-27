// Package appconfig is a thin cache layer over the app_config table.
// All config keys are stored as JSONB; this package hides the type coercion
// and adds a 60s TTL so hot paths (tax calc, corridor detection) do not
// hammer the DB.
package appconfig

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

const defaultTTL = 60 * time.Second

type entry struct {
	raw       json.RawMessage
	fetchedAt time.Time
}

type Reader struct {
	db    *sql.DB
	mu    sync.RWMutex
	cache map[string]entry
	ttl   time.Duration
}

func New(db *sql.DB) *Reader {
	return &Reader{db: db, cache: make(map[string]entry), ttl: defaultTTL}
}

func (r *Reader) getRaw(ctx context.Context, key string) (json.RawMessage, error) {
	r.mu.RLock()
	if e, ok := r.cache[key]; ok && time.Since(e.fetchedAt) < r.ttl {
		r.mu.RUnlock()
		return e.raw, nil
	}
	r.mu.RUnlock()

	var raw []byte
	err := r.db.QueryRowContext(ctx,
		"SELECT value FROM public.app_config WHERE key = $1", key).Scan(&raw)
	if err != nil {
		return nil, fmt.Errorf("appconfig %q: %w", key, err)
	}

	r.mu.Lock()
	r.cache[key] = entry{raw: raw, fetchedAt: time.Now()}
	r.mu.Unlock()
	return raw, nil
}

func (r *Reader) GetInt(ctx context.Context, key string) (int, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return 0, err
	}
	var v int
	if err := json.Unmarshal(raw, &v); err != nil {
		return 0, fmt.Errorf("appconfig %q as int: %w", key, err)
	}
	return v, nil
}

func (r *Reader) GetFloat(ctx context.Context, key string) (float64, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return 0, err
	}
	var v float64
	if err := json.Unmarshal(raw, &v); err != nil {
		return 0, fmt.Errorf("appconfig %q as float: %w", key, err)
	}
	return v, nil
}

func (r *Reader) GetBool(ctx context.Context, key string) (bool, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return false, err
	}
	var v bool
	if err := json.Unmarshal(raw, &v); err != nil {
		return false, fmt.Errorf("appconfig %q as bool: %w", key, err)
	}
	return v, nil
}

func (r *Reader) GetString(ctx context.Context, key string) (string, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return "", err
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", fmt.Errorf("appconfig %q as string: %w", key, err)
	}
	return v, nil
}

func (r *Reader) GetStringSlice(ctx context.Context, key string) ([]string, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return nil, err
	}
	var v []string
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("appconfig %q as []string: %w", key, err)
	}
	return v, nil
}

// GetJSON unmarshals the JSON value at key into out. Uses the 60s TTL cache.
func (r *Reader) GetJSON(ctx context.Context, key string, out any) error {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("appconfig %q: unmarshal: %w", key, err)
	}
	return nil
}
