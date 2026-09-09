// Browser-side init — a separate DSN env var from the server/edge
// configs' SENTRY_DSN, because this file ships inside the client
// bundle: only a NEXT_PUBLIC_-prefixed var gets inlined into it at
// build time (same reasoning as this app's existing
// NEXT_PUBLIC_BACKEND_URL — see next.config.mjs's Dockerfile ARG for
// that one). No-op when unset, same posture as every other Sentry
// config in this repo.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});

// Required export, per the SDK's own build-time warning otherwise —
// without it, client-side route changes (App Router navigations) aren't
// tracked as their own performance transactions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
