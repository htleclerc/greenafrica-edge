package middleware

import (
	"net/http"
	"time"

	sentryhttp "github.com/getsentry/sentry-go/http"
)

// Sentry wraps handlers so panics are captured and reported to Sentry. It is a
// no-op unless sentry.Init has run with a DSN — main.go only installs this
// middleware when SENTRY_DSN is set, so a DSN-less deploy carries zero overhead.
// Repanic: true lets Go's net/http per-request recovery still return the 500
// after Sentry has recorded the panic (the server does not crash).
func Sentry() Middleware {
	h := sentryhttp.New(sentryhttp.Options{
		Repanic:         true,
		WaitForDelivery: false,
		Timeout:         2 * time.Second,
	})
	return func(next http.Handler) http.Handler {
		return h.Handle(next)
	}
}
