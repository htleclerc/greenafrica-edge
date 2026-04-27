package ais

import (
	"encoding/json"
	"testing"
	"time"
)

const staticDataSample = `{
  "MessageType": "ShipStaticData",
  "MetaData": {
    "MMSI": 123456789,
    "MMSI_String": "123456789",
    "ShipName": "MV TESTSHIP",
    "latitude": 1.234,
    "longitude": 100.567,
    "time_utc": "2026-04-27 10:00:00 +0000 UTC"
  },
  "Message": {
    "ShipStaticData": {
      "ImoNumber": 9999999,
      "Destination": "BERBERA",
      "Eta": {"Month": 5, "Day": 12, "Hour": 14, "Minute": 30}
    }
  }
}`

func TestParseShipStaticData(t *testing.T) {
	var msg AISMessage
	if err := json.Unmarshal([]byte(staticDataSample), &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg.MessageType != "ShipStaticData" {
		t.Fatalf("wrong MessageType: %s", msg.MessageType)
	}
	if msg.Message.ShipStaticData == nil {
		t.Fatalf("ShipStaticData not parsed")
	}
	s := msg.Message.ShipStaticData
	if s.ImoNumber != 9999999 {
		t.Errorf("ImoNumber = %d, want 9999999", s.ImoNumber)
	}
	if s.Destination != "BERBERA" {
		t.Errorf("Destination = %q, want BERBERA", s.Destination)
	}
	if s.Eta.Month != 5 || s.Eta.Day != 12 || s.Eta.Hour != 14 || s.Eta.Minute != 30 {
		t.Errorf("Eta = %+v", s.Eta)
	}
}

func TestDecodeETA_PastMonthRollsToNextYear(t *testing.T) {
	// In May 2026; ETA says April 1 → must mean April 2027.
	now := time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)
	got := DecodeETA(AISETAField{Month: 4, Day: 1, Hour: 12, Minute: 0}, now)
	if got.Year() != 2027 {
		t.Errorf("year = %d, want 2027 (rollover)", got.Year())
	}
	if got.Month() != time.April {
		t.Errorf("month = %v, want April", got.Month())
	}
}

func TestDecodeETA_FutureMonthSameYear(t *testing.T) {
	now := time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)
	got := DecodeETA(AISETAField{Month: 11, Day: 20, Hour: 0, Minute: 0}, now)
	if got.Year() != 2026 {
		t.Errorf("year = %d, want 2026", got.Year())
	}
	if got.Month() != time.November {
		t.Errorf("month = %v, want November", got.Month())
	}
}

func TestDecodeETA_InvalidFieldsReturnsZero(t *testing.T) {
	// AIS-5 sentinels for "not available": Month=0, Day=0
	now := time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)
	got := DecodeETA(AISETAField{Month: 0, Day: 0, Hour: 24, Minute: 60}, now)
	if !got.IsZero() {
		t.Errorf("expected zero time for sentinel input, got %s", got)
	}
}

func TestDecodeETA_PreservesPositionReportSchema(t *testing.T) {
	// Sanity check: parsing a PositionReport message still works after struct change.
	const positionSample = `{
	  "MessageType": "PositionReport",
	  "MetaData": {"MMSI_String":"111","ShipName":"X","latitude":1.0,"longitude":2.0,"time_utc":"2026-04-27 10:00:00 +0000 UTC"},
	  "Message": {"PositionReport": {"Cog": 90.0, "Sog": 120, "TrueHeading": 88}}
	}`
	var msg AISMessage
	if err := json.Unmarshal([]byte(positionSample), &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg.Message.PositionReport == nil {
		t.Fatalf("PositionReport regressed")
	}
	if msg.Message.PositionReport.Sog != 120 {
		t.Errorf("Sog = %v", msg.Message.PositionReport.Sog)
	}
}
