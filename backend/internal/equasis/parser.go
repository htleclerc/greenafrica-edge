// Package equasis parses public Equasis vessel pages into proposal records.
//
// SCAFFOLD STATUS: regex-based extraction targeting fixture HTML files in
// backend/testdata/equasis/. Real Equasis pages render via JavaScript and
// require an authenticated session — those will need a different fetcher
// (headless browser) and likely a structurally different parser. This
// package's contract (Parse → Proposal | Error) survives the rewrite.
//
// Parse returns ErrCaptcha when the HTML clearly indicates a login or
// CAPTCHA wall — the worker uses that signal to mark the proposal source
// as the partial state rather than retrying blindly.
package equasis

import (
	"errors"
	"regexp"
	"strings"
)

// Proposal mirrors the columns the worker will write to
// equasis_scrape_proposals. Empty strings denote "field not extractable
// from this page" — the apply action ignores them.
type Proposal struct {
	IMONumber    string
	OwnerName    string
	Manager      string
	Email        string
	Country      string
}

// ErrCaptcha is returned when the Equasis page is gated by a CAPTCHA or
// login form. Callers should NOT retry without changing fetcher state.
var ErrCaptcha = errors.New("equasis: page is gated by captcha or login")

// ErrIMONotFound is returned when the page renders a "No vessel found"
// state for the given IMO. Caller should ack the message and stop.
var ErrIMONotFound = errors.New("equasis: vessel page reports no record")

// ── Regex matchers ─────────────────────────────────────────────────────────
// Equasis layouts use <td>Label</td>\s*<td>Value</td> rows. We anchor on
// canonical labels and extract the immediately-following <td> contents.

var (
	imoRe       = regexp.MustCompile(`(?is)<td[^>]*>\s*IMO\s*(?:number|n[°o]\.?)?\s*</td>\s*<td[^>]*>\s*(\d{5,9})\s*</td>`)
	ownerRe     = regexp.MustCompile(`(?is)<td[^>]*>\s*(?:Registered\s+)?Owner\s*</td>\s*<td[^>]*>\s*(.+?)\s*</td>`)
	managerRe   = regexp.MustCompile(`(?is)<td[^>]*>\s*(?:ISM\s+)?Manager\s*</td>\s*<td[^>]*>\s*(.+?)\s*</td>`)
	emailRe     = regexp.MustCompile(`(?is)<td[^>]*>\s*Email\s*</td>\s*<td[^>]*>\s*(?:<a[^>]*>)?\s*(.+?)\s*(?:</a>)?\s*</td>`)
	countryRe   = regexp.MustCompile(`(?is)<td[^>]*>\s*Flag\s*</td>\s*<td[^>]*>\s*([A-Z]{2,3})\s*(?:\(.+?\))?\s*</td>`)
	notFoundRe  = regexp.MustCompile(`(?is)(no\s+(?:vessel|record).+?(?:found|matches))|(no\s+results)`)
	captchaRe   = regexp.MustCompile(`(?is)(captcha|please\s+log\s+in|sign\s+in\s+to\s+continue|access\s+denied)`)
)

// Parse extracts a Proposal from raw Equasis HTML. Empty fields are valid
// — the calling worker stores the proposal as-is, the apply action ignores
// blanks. Returns ErrCaptcha or ErrIMONotFound for the structural error
// states the worker reports differently.
func Parse(html string) (Proposal, error) {
	if captchaRe.MatchString(html) {
		return Proposal{}, ErrCaptcha
	}
	if notFoundRe.MatchString(html) {
		return Proposal{}, ErrIMONotFound
	}

	p := Proposal{}
	if m := imoRe.FindStringSubmatch(html); len(m) > 1 {
		p.IMONumber = strings.TrimSpace(m[1])
	}
	if m := ownerRe.FindStringSubmatch(html); len(m) > 1 {
		p.OwnerName = stripTags(m[1])
	}
	if m := managerRe.FindStringSubmatch(html); len(m) > 1 {
		p.Manager = stripTags(m[1])
	}
	if m := emailRe.FindStringSubmatch(html); len(m) > 1 {
		// Filter out dummy / hidden values Equasis uses when not authenticated.
		v := stripTags(m[1])
		if v != "" && !strings.Contains(strings.ToLower(v), "log in") {
			p.Email = v
		}
	}
	if m := countryRe.FindStringSubmatch(html); len(m) > 1 {
		p.Country = strings.TrimSpace(m[1])
	}

	return p, nil
}

// stripTags removes any inner HTML markup. Cheap implementation — fine
// for fixture-driven testing. A real implementation would use html
// tokeniser, but this scaffold prefers zero dependencies.
var tagRe = regexp.MustCompile(`<[^>]+>`)

func stripTags(s string) string {
	cleaned := tagRe.ReplaceAllString(s, "")
	cleaned = strings.ReplaceAll(cleaned, "&nbsp;", " ")
	return strings.TrimSpace(cleaned)
}
