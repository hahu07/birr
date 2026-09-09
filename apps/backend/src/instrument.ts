// Imported as the literal first line of main.ts, before even the NestJS
// imports — @sentry/nestjs's OpenTelemetry-based auto-instrumentation
// needs to patch modules (http, pg, etc.) before anything else requires
// them; calling Sentry.init() from inside bootstrap() would be too late
// for most of it. No-op when SENTRY_DSN is unset (local dev, and any
// deployment that hasn't configured one yet) — never a hard requirement
// to boot.
import * as Sentry from "@sentry/nestjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
