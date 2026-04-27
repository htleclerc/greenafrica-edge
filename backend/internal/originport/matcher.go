// Package originport implements scenario A detection: vessels declaring
// Berbera/Zeila as their AIS-5 Destination at origin port. Gated by
// app_config.feature.ais_global_enabled. See
// docs/superpowers/specs/2026-04-27-plan-8-ais-global-origin-port-detection.md
package originport

import (
	"strings"
	"unicode"
)

// AllowList maps canonical port name → variants. Loaded from
// app_config.arrival.origin_port_allow_list. The first entry of each
// slice should be the canonical name itself; that ordering is asserted
// by mig 045's test.
type AllowList map[string][]string

// MatchKind discriminates the three outcomes of MatchDestination.
type MatchKind int

const (
	MatchNone    MatchKind = 0 // no match — drop silently
	MatchAllow   MatchKind = 1 // allow-list hit — INSERT arrival_alerts
	MatchPropose MatchKind = 2 // fuzzy candidate — INSERT destination_match_proposals
)

// MatchResult is the outcome of MatchDestination for a given raw input.
type MatchResult struct {
	Kind       MatchKind
	Port       string // canonical port name, "" if MatchNone
	Normalized string // post-normalization input (for logging / proposal storage)
	FuzzyScore int    // Levenshtein distance, set only when Kind=MatchPropose
}

// MatchDestination decides what to do with a raw AIS Destination string.
//
// Algorithm:
//  1. Normalize (UPPER, trim, strip non-alphanumeric except spaces, collapse spaces)
//  2. For each (port, variants) in allow, if any variant is a substring of
//     the normalized input, return MatchAllow.
//  3. Otherwise compute Levenshtein vs each canonical port name; if min
//     distance <= 2 return MatchPropose against the closest port.
//  4. Otherwise MatchNone.
func MatchDestination(raw string, allow AllowList) MatchResult {
	norm := Normalize(raw)
	if norm == "" {
		return MatchResult{Kind: MatchNone}
	}

	// Step 2: allow-list substring check
	for port, variants := range allow {
		for _, v := range variants {
			if v == "" {
				continue
			}
			if strings.Contains(norm, v) {
				return MatchResult{Kind: MatchAllow, Port: port, Normalized: norm}
			}
		}
	}

	// Step 3: fuzzy match against canonical names
	best := MatchResult{Kind: MatchNone, Normalized: norm}
	bestScore := 999
	for port := range allow {
		d := Levenshtein(norm, port)
		if d < bestScore {
			bestScore = d
			best = MatchResult{
				Kind:       MatchPropose,
				Port:       port,
				Normalized: norm,
				FuzzyScore: d,
			}
		}
	}
	if bestScore <= 2 {
		return best
	}
	return MatchResult{Kind: MatchNone, Normalized: norm}
}

// Normalize uppercases, trims, replaces non-alphanumeric with space, then
// collapses consecutive spaces. Preserves Latin letters and digits only.
func Normalize(raw string) string {
	if raw == "" {
		return ""
	}
	upper := strings.ToUpper(raw)
	var b strings.Builder
	b.Grow(len(upper))
	prevSpace := true
	for _, r := range upper {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prevSpace = false
		} else if !prevSpace {
			b.WriteRune(' ')
			prevSpace = true
		}
	}
	return strings.TrimSpace(b.String())
}

// Levenshtein returns the edit distance between a and b. O(len(a)*len(b))
// time, O(min(len(a),len(b))) space. Inlined to avoid pulling a dep.
func Levenshtein(a, b string) int {
	ar := []rune(a)
	br := []rune(b)
	if len(ar) == 0 {
		return len(br)
	}
	if len(br) == 0 {
		return len(ar)
	}
	if len(ar) < len(br) {
		ar, br = br, ar
	}
	prev := make([]int, len(br)+1)
	curr := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ar); i++ {
		curr[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			del := prev[j] + 1
			ins := curr[j-1] + 1
			sub := prev[j-1] + cost
			curr[j] = min3(del, ins, sub)
		}
		prev, curr = curr, prev
	}
	return prev[len(br)]
}

func min3(a, b, c int) int {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}
