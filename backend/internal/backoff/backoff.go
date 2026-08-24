// Package backoff holds the one retry policy shared by every long-running
// loop of the backend.
//
// Il existe parce que la même erreur a été commise deux fois. Le scraper
// Equasis reconnectait toutes les 30 s sans relâche et finissait par armer le
// disjoncteur du pooler Supabase, qui remonte alors en « password
// authentication failed » et bloque toute la stack. L'ingesteur AIS
// reconnecte toutes les 5 s : le 2026-08-24, la machine de production ouvrait
// ~14 400 connexions par jour vers aisstream, fermées par le serveur une
// seconde après l'abonnement — staging et prod partageant la même clé de
// tier gratuit, les deux environnements se chassaient probablement l'un
// l'autre.
//
// Une boucle de reconnexion à délai fixe ne se contente pas d'échouer : elle
// aggrave la panne qu'elle essaie de traverser.
package backoff

import "time"

// Policy borne un délai de réessai entre Min et Max.
type Policy struct {
	Min time.Duration
	Max time.Duration
}

// Next double prev, ramené dans [Min, Max]. Passer 0 (ou toute valeur
// inférieure à Min) donne Min : c'est le premier réessai. Remettre la variable
// à zéro au premier succès pour repartir de Min.
func (p Policy) Next(prev time.Duration) time.Duration {
	if p.Min <= 0 {
		p.Min = time.Second
	}
	if p.Max < p.Min {
		p.Max = p.Min
	}
	if prev < p.Min {
		return p.Min
	}
	if next := prev * 2; next < p.Max {
		return next
	}
	return p.Max
}
