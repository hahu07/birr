// Loaded by instrumentation.ts when NEXT_RUNTIME === "nodejs" — the
// Node.js server runtime (route handlers, server components, etc.), as
// distinct from the separate edge runtime config below it. No-op when
// SENTRY_DSN is unset, same posture as every other Sentry config in this
// repo (see apps/backend/src/instrument.ts's own comment).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
