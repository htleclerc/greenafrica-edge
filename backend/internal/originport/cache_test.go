package originport

import (
	"sync"
	"testing"
	"time"
)

func TestCache_PutGet(t *testing.T) {
	c := NewCache()
	c.Put("123456789", VesselState{IMO: "9999999", Destination: "BERBERA"})
	got, ok := c.Get("123456789")
	if !ok {
		t.Fatalf("expected hit, got miss")
	}
	if got.IMO != "9999999" || got.Destination != "BERBERA" {
		t.Errorf("got %+v", got)
	}
}

func TestCache_TTLExpiry(t *testing.T) {
	c := NewCache()
	c.now = func() time.Time { return time.Unix(1000, 0) }
	c.Put("M1", VesselState{IMO: "I1"})
	// Advance past TTL
	c.now = func() time.Time { return time.Unix(1000, 0).Add(CacheTTL + time.Second) }
	if _, ok := c.Get("M1"); ok {
		t.Errorf("expected expiry, got hit")
	}
}

func TestCache_OverwriteRefreshesTTL(t *testing.T) {
	c := NewCache()
	c.now = func() time.Time { return time.Unix(1000, 0) }
	c.Put("M1", VesselState{IMO: "I1"})
	c.now = func() time.Time { return time.Unix(1000, 0).Add(CacheTTL - time.Second) }
	c.Put("M1", VesselState{IMO: "I2"}) // overwrite
	c.now = func() time.Time { return time.Unix(1000, 0).Add(CacheTTL + time.Second) }
	got, ok := c.Get("M1")
	if !ok {
		t.Fatalf("expected hit after refresh, got miss")
	}
	if got.IMO != "I2" {
		t.Errorf("expected I2 after refresh, got %s", got.IMO)
	}
}

func TestCache_Concurrency(t *testing.T) {
	c := NewCache()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			c.Put("M"+string(rune(i)), VesselState{IMO: "I"})
		}(i)
		go func(i int) {
			defer wg.Done()
			c.Get("M" + string(rune(i)))
		}(i)
	}
	wg.Wait()
}
