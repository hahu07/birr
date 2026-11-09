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
  // Sentry v11 collects user info, cookies, request/response bodies and
  // database query data by default when this is unset; v10 sent none of
  // it. These are Sentry's documented settings for keeping v10's
  // behaviour. Loosen only as a deliberate decision.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
    },
    httpBodies: [],
    urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    graphQL: { document: false, variables: false },
  },
});
