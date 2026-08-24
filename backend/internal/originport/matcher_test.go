package originport

import "testing"

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"":                    "",
		"BERBERA":             "BERBERA",
		"berbera":             "BERBERA",
		"  Berbera ":          "BERBERA",
		"BERBERA, SOMALILAND": "BERBERA SOMALILAND",
		"BBR>DJB":             "BBR DJB",
		"BBR / DJB":           "BBR DJB",
		"Berbara":             "BERBARA",
	}
	for in, want := range cases {
		got := Normalize(in)
		if got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLevenshtein(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"", "", 0},
		{"BERBERA", "BERBERA", 0},
		{"BERBARA", "BERBERA", 1},
		{"ZEYLA", "ZEILA", 1},
		{"DJIBOUTI", "BERBERA", 7},
		{"", "BERBERA", 7},
	}
	for _, c := range cases {
		if got := Levenshtein(c.a, c.b); got != c.want {
			t.Errorf("Levenshtein(%q,%q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestMatchDestination(t *testing.T) {
	allow := AllowList{
		"BERBERA": {"BERBERA", "BBR", "BERBA", "BERBARA", "SBE", "SOMA BBR", "SOMALILAND BERBERA"},
		"ZEILA":   {"ZEILA", "ZEYLA", "ZELA"},
	}
	cases := []struct {
		raw   string
		kind  MatchKind
		port  string // "" if MatchNone
		score int    // 0 unless MatchPropose
	}{
		// Direct match in allow-list
		{"BERBERA", MatchAllow, "BERBERA", 0},
		{"berbera", MatchAllow, "BERBERA", 0},
		{"BBR", MatchAllow, "BERBERA", 0},
		{"  BBR  ", MatchAllow, "BERBERA", 0},
		{"BERBERA, SOMALILAND", MatchAllow, "BERBERA", 0}, // la ponctuation devient un espace
		{"SOMALILAND BERBERA", MatchAllow, "BERBERA", 0},
		{"ZEILA", MatchAllow, "ZEILA", 0},
		{"ZEYLA", MatchAllow, "ZEILA", 0},
		// Fuzzy proposals (Levenshtein <= 2 vs canonical name, not in allow-list)
		{"BERBERR", MatchPropose, "BERBERA", 1}, // typo, not in allow-list
		{"BARBARA", MatchPropose, "BERBERA", 2}, // 2 swaps
		{"ZELLA", MatchPropose, "ZEILA", 1},
		// Faux positifs mesures le 2026-08-24 sur dix minutes du flux
		// ShipStaticData mondial. Avec l'ancien `strings.Contains`, chacun de
		// ces navires — en route pour la Norvege ou l'Allemagne — declenchait
		// un arrival_alerts a Berbera, donc une pro-forma de taxe carbone.
		{"TONSBERG", MatchNone, "", 0},             // contenait SBE
		{"T. SPITSBERGEN", MatchNone, "", 0},       // SPIT-SBE-RGEN
		{"BAD GODESBERG FAEHRE", MatchNone, "", 0}, // GODE-SBE-RG
		{"BBREMERHAVEN", MatchNone, "", 0},         // contenait BBR
		// Les formes legitimes restent reconnues
		{"SOMA BBR", MatchAllow, "BERBERA", 0},
		{"BBR ANCHORAGE", MatchAllow, "BERBERA", 0},
		{"FOR SBE", MatchAllow, "BERBERA", 0},
		// No match: unrelated ports
		{"DJIBOUTI", MatchNone, "", 0},
		{"DJB", MatchNone, "", 0},
		{"BOSASO", MatchNone, "", 0},
		{"MOGADISHU", MatchNone, "", 0},
		{"DUBAI", MatchNone, "", 0},
		// Edge cases
		{"", MatchNone, "", 0},
		{"   ", MatchNone, "", 0},
		{"???", MatchNone, "", 0},
	}
	for _, c := range cases {
		t.Run(c.raw, func(t *testing.T) {
			got := MatchDestination(c.raw, allow)
			if got.Kind != c.kind {
				t.Errorf("Kind = %v, want %v", got.Kind, c.kind)
			}
			if got.Port != c.port {
				t.Errorf("Port = %q, want %q", got.Port, c.port)
			}
			if got.Kind == MatchPropose && got.FuzzyScore != c.score {
				t.Errorf("FuzzyScore = %d, want %d", got.FuzzyScore, c.score)
			}
		})
	}
}
