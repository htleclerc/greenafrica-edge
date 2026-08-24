package ais

import (
	"strings"
	"testing"
	"time"
)

// Le cas qui a motivé ce champ : running=true pendant 37 jours, 0 message,
// 49 250 erreurs de connexion, et aucune supervision pour le dire.
func TestHealth(t *testing.T) {
	now := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name      string
		st        Stats
		want      string
		reasonHas string
	}{
		{"arrêté", Stats{Running: false}, "stopped", ""},
		{
			"vient de démarrer, rien reçu — pas encore un verdict",
			Stats{Running: true, StartedAt: now.Add(-1 * time.Minute)},
			"ok", "",
		},
		{
			"37 jours sans le moindre message",
			Stats{Running: true, StartedAt: now.AddDate(0, 0, -37), Errors: 49250},
			"degraded", "aucun message depuis le demarrage",
		},
		{
			"a reçu, puis s'est tu",
			Stats{Running: true, StartedAt: now.Add(-2 * time.Hour),
				MessagesTotal: 10, LastMessageAt: now.Add(-30 * time.Minute)},
			"degraded", "dernier message il y a 30m",
		},
		{
			// Le motif doit dire POURQUOI, sinon il faut aller lire les logs
			// de l'hebergeur — ce que ce champ existe pour eviter.
			"le dernier echec est repris dans le motif",
			Stats{Running: true, StartedAt: now.AddDate(0, 0, -37), Errors: 49250,
				LastError: "websocket: close 1006 (abnormal closure)"},
			"degraded", "dernier echec : websocket: close 1006",
		},
		{
			"flux vivant",
			Stats{Running: true, StartedAt: now.Add(-2 * time.Hour),
				MessagesTotal: 10, LastMessageAt: now.Add(-10 * time.Second)},
			"ok", "",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, reason := health(c.st, now)
			if got != c.want {
				t.Fatalf("health = %q, want %q (reason=%q)", got, c.want, reason)
			}
			if c.reasonHas != "" && !strings.Contains(reason, c.reasonHas) {
				t.Fatalf("reason = %q, want it to contain %q", reason, c.reasonHas)
			}
			if c.reasonHas == "" && reason != "" {
				t.Fatalf("reason = %q, want empty", reason)
			}
		})
	}
}
