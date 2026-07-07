package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The Sentry middleware must pass normal requests through untouched, even with
// no sentry.Init (DSN-less) — it only reports panics, it never alters responses.
func TestSentryPassThrough(t *testing.T) {
	h := Sentry()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("ok"))
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))

	if rec.Code != http.StatusTeapot {
		t.Fatalf("expected 418 pass-through, got %d", rec.Code)
	}
	if rec.Body.String() != "ok" {
		t.Fatalf("expected body %q, got %q", "ok", rec.Body.String())
	}
}
