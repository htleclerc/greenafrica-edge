package originport

import (
	"sync"
	"time"
)

// CacheTTL bounds how long a vessel's last-seen static data is remembered.
// Tunable: increase if dropped messages cause many redundant alerts, decrease
// if memory grows. Measure via len(Cache.entries) periodically.
const CacheTTL = 24 * time.Hour

// VesselState is what we remember per MMSI between ShipStaticData broadcasts.
type VesselState struct {
	IMO         string
	Destination string
}

type cacheEntry struct {
	state VesselState
	at    time.Time
}

// Cache is an MMSI→VesselState store with per-entry TTL. Race-safe.
// Not strictly LRU — we don't bound size, we bound age. Memory is dominated
// by the number of distinct MMSIs seen in a 24h window (≤200k worldwide).
type Cache struct {
	mu      sync.RWMutex
	entries map[string]cacheEntry
	now     func() time.Time // injectable for tests
}

func NewCache() *Cache {
	return &Cache{
		entries: make(map[string]cacheEntry),
		now:     time.Now,
	}
}

// Put records the latest VesselState for mmsi at the current time.
// Overwrites any prior entry; refreshes TTL.
func (c *Cache) Put(mmsi string, s VesselState) {
	c.mu.Lock()
	c.entries[mmsi] = cacheEntry{state: s, at: c.now()}
	c.mu.Unlock()
}

// Get returns the cached state and true if present and within TTL.
// Expired entries are returned as miss; they remain in the map until
// overwritten or the next sweep.
func (c *Cache) Get(mmsi string) (VesselState, bool) {
	c.mu.RLock()
	e, ok := c.entries[mmsi]
	c.mu.RUnlock()
	if !ok {
		return VesselState{}, false
	}
	if c.now().Sub(e.at) > CacheTTL {
		return VesselState{}, false
	}
	return e.state, true
}

// Len returns the number of entries (expired or not). Useful for memory
// observability via expvar / log sampling.
func (c *Cache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}
