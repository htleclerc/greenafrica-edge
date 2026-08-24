package backoff

import (
	"testing"
	"time"
)

func TestNext(t *testing.T) {
	p := Policy{Min: 5 * time.Second, Max: 5 * time.Minute}
	cases := []struct{ prev, want time.Duration }{
		{0, 5 * time.Second},
		{time.Second, 5 * time.Second},
		{5 * time.Second, 10 * time.Second},
		{2 * time.Minute, 4 * time.Minute},
		{4 * time.Minute, 5 * time.Minute},
		{5 * time.Minute, 5 * time.Minute},
		{time.Hour, 5 * time.Minute},
	}
	for _, c := range cases {
		if got := p.Next(c.prev); got != c.want {
			t.Errorf("Next(%s) = %s, want %s", c.prev, got, c.want)
		}
	}
}

// Une policy vide ne doit pas produire un délai nul : ce serait une boucle
// serrée, exactement ce que ce paquet existe pour empêcher.
func TestNext_ZeroPolicyStillBacksOff(t *testing.T) {
	var p Policy
	if got := p.Next(0); got <= 0 {
		t.Fatalf("Next(0) sur une policy vide = %s, veut un délai strictement positif", got)
	}
}

func TestNext_MaxBelowMinIsClamped(t *testing.T) {
	p := Policy{Min: 30 * time.Second, Max: time.Second}
	if got := p.Next(time.Minute); got != 30*time.Second {
		t.Fatalf("Next = %s, want %s", got, 30*time.Second)
	}
}
