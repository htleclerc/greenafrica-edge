package ais

import (
	"encoding/json"
	"testing"
)

// Une boite mal formee n'est pas rejetee par aisstream : l'abonnement est
// confirme et le flux reste vide. Le silence ressemble alors a « pas de
// trafic » alors que c'est « configuration cassee ». D'ou la validation.
func TestParseBoxes(t *testing.T) {
	cases := []struct {
		name string
		in   string
		ok   bool
	}{
		{"config valide, deux zones", `[[[12,32],[32,44]],[[0,40],[28,78]]]`, true},
		{"vide", `[]`, false},
		{"pas du JSON", `{`, false},
		{"coin manquant", `[[[12,32]]]`, false},
		{"latitude hors bornes", `[[[12,32],[95,44]]]`, false},
		{"longitude hors bornes", `[[[12,-200],[32,44]]]`, false},
		{"coins inverses en latitude", `[[[32,32],[12,44]]]`, false},
		{"coins inverses en longitude", `[[[12,44],[32,32]]]`, false},
		{"boite degeneree", `[[[12,32],[12,32]]]`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, ok := parseBoxes([]byte(c.in))
			if ok != c.ok {
				t.Fatalf("parseBoxes(%s) ok = %v, want %v", c.in, ok, c.ok)
			}
		})
	}
}

// Le defaut embarque doit lui-meme passer la validation, sinon le repli
// enverrait une configuration invalide.
func TestDefaultRegionalBoxesAreValid(t *testing.T) {
	raw, err := json.Marshal(defaultRegionalBoxes)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, ok := parseBoxes(raw); !ok {
		t.Fatalf("le defaut embarque ne passe pas parseBoxes: %s", raw)
	}
}
