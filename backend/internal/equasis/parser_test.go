package equasis

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// fixturesDir resolves the testdata/equasis path relative to repo root.
// Go runs tests from the package directory by default, so testdata is
// reached via ../../../testdata/equasis from this file's location.
func fixturesDir(t *testing.T) string {
	t.Helper()
	here, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	return filepath.Join(here, "..", "..", "testdata", "equasis")
}

func loadFixture(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(fixturesDir(t), name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(data)
}

func TestParse_Happy(t *testing.T) {
	got, err := Parse(loadFixture(t, "happy.html"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := Proposal{
		IMONumber: "9876543",
		OwnerName: "Acme Maritime Ltd",
		Manager:   "Acme Ship Management Inc.",
		Email:     "ops@acme-maritime.com",
		Country:   "PA",
	}
	if got != want {
		t.Errorf("Parse() = %+v, want %+v", got, want)
	}
}

func TestParse_NoEmail(t *testing.T) {
	got, err := Parse(loadFixture(t, "no_email.html"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.IMONumber != "9123456" {
		t.Errorf("IMONumber = %q, want 9123456", got.IMONumber)
	}
	if got.OwnerName != "Berbera Shipping Co Ltd" {
		t.Errorf("OwnerName = %q", got.OwnerName)
	}
	if got.Email != "" {
		t.Errorf("Email = %q, want empty (login-gated)", got.Email)
	}
	if got.Country != "SO" {
		t.Errorf("Country = %q, want SO", got.Country)
	}
}

func TestParse_Captcha(t *testing.T) {
	_, err := Parse(loadFixture(t, "captcha.html"))
	if !errors.Is(err, ErrCaptcha) {
		t.Errorf("err = %v, want ErrCaptcha", err)
	}
}

func TestParse_NotFound(t *testing.T) {
	_, err := Parse(loadFixture(t, "not_found.html"))
	if !errors.Is(err, ErrIMONotFound) {
		t.Errorf("err = %v, want ErrIMONotFound", err)
	}
}

func TestParse_EmptyHTML(t *testing.T) {
	got, err := Parse("")
	if err != nil {
		t.Errorf("unexpected error on empty input: %v", err)
	}
	if got != (Proposal{}) {
		t.Errorf("expected zero Proposal, got %+v", got)
	}
}

func TestParse_PartialFields_DoesNotPanic(t *testing.T) {
	// Half-rendered page: only IMO + owner. Other fields stay empty,
	// no error. The apply action handles empty fields by ignoring them.
	html := `<table>
		<tr><td>IMO number</td><td>1234567</td></tr>
		<tr><td>Owner</td><td>Test Co</td></tr>
	</table>`
	got, err := Parse(html)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.IMONumber != "1234567" || got.OwnerName != "Test Co" {
		t.Errorf("partial parse failed: %+v", got)
	}
	if got.Email != "" || got.Manager != "" || got.Country != "" {
		t.Errorf("expected empty fields for missing rows, got %+v", got)
	}
}
