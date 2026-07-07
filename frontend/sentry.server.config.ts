// Sentry — server runtime (Node) init. Loaded by instrumentation.ts.
// Fully inert unless NEXT_PUBLIC_SENTRY_DSN is set, so dev/CI and any deploy
// without a DSN behave exactly as before. No PII is sent (fiscal platform).
import * as Sentry from '@sentry/nextjs';

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
});
