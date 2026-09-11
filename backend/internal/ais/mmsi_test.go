package ais

import (
	"encoding/json"
	"testing"
)

// aisstream a change la forme de MMSI_String sans prevenir. Le champ etait type
// `string` ; le serveur envoie un nombre. json.Unmarshal echoue alors sur la
// trame ENTIERE et l'ingesteur la jette avant le dispatch — 254 500 trames
// consecutives en prod le 2026-09-08, zero position ecrite, zero destination
// examinee. Ce test verrouille les deux formes, dans les deux sens.
func TestAISMMSIAcceptsNumberAndString(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
		ok   bool
	}{
		{"forme numerique (ce que le serveur envoie depuis 2026-09)", `259490000`, "259490000", true},
		{"forme chaine (ce qu'il envoyait avant)", `"259490000"`, "259490000", true},
		{"null", `null`, "", true},
		{"chaine vide", `""`, "", true},
		{"objet — ni chaine ni nombre", `{"a":1}`, "", false},
		{"tableau", `[1]`, "", false},
		{"booleen", `true`, "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var m AISMMSI
			err := json.Unmarshal([]byte(c.in), &m)
			if c.ok && err != nil {
				t.Fatalf("Unmarshal(%s) = %v, attendu succes", c.in, err)
			}
			if !c.ok {
				if err == nil {
					t.Fatalf("Unmarshal(%s) a reussi, attendu un echec", c.in)
				}
				return
			}
			if string(m) != c.want {
				t.Fatalf("Unmarshal(%s) = %q, attendu %q", c.in, string(m), c.want)
			}
		})
	}
}

// Trame reellement relevee dans les logs de greengate-prod le 2026-09-07 a
// 21:56:22 UTC. C'est la forme exacte qui faisait tomber l'ingesteur : le test
// echoue si on retype MMSI_String en `string`.
func TestRealFrameFromProdIsNotDiscarded(t *testing.T) {
	raw := []byte(`{"MetaData":{"MMSI":259490000,"MMSI_String":259490000,` +
		`"ShipName":"SUPERSPEED 1","latitude":58.14201,"longitude":7.98698,` +
		`"time_utc":"2026-09-07 21:56:22.080675049 +0000 UTC"},` +
		`"MessageType":"ShipStaticData",` +
		`"Message":{"ShipStaticData":{"ImoNumber":9000000,"Destination":"BERBERA"}}}`)

	var msg AISMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("la trame de prod ne se decode pas: %v", err)
	}
	// La condition de rebut de la boucle de lecture.
	if msg.MetaData.MMSIStr == "" {
		t.Fatal("MMSI vide — la trame partirait au rebut, comme avant le correctif")
	}
	if string(msg.MetaData.MMSIStr) != "259490000" {
		t.Fatalf("MMSI = %q, attendu \"259490000\"", string(msg.MetaData.MMSIStr))
	}
	if msg.MessageType != "ShipStaticData" {
		t.Fatalf("MessageType = %q", msg.MessageType)
	}
	// Le champ qui porte tout l'interet du mode observation.
	if msg.Message.ShipStaticData == nil || msg.Message.ShipStaticData.Destination != "BERBERA" {
		t.Fatal("la destination declaree n'a pas survecu au decodage")
	}
}

// Le MMSI repart en chaine vers Supabase et vers originport.StaticReport : un
// type nomme sur string doit se re-serialiser en chaine, pas en nombre.
func TestAISMMSIMarshalsBackAsString(t *testing.T) {
	out, err := json.Marshal(map[string]any{"mmsi": AISMMSI("259490000")})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(out) != `{"mmsi":"259490000"}` {
		t.Fatalf("re-serialisation = %s, attendu {\"mmsi\":\"259490000\"}", out)
	}
}
