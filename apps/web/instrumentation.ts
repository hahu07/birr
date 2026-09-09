import * as Sentry from "@sentry/nextjs";

// Next.js's own hook (App Router, requires no config flag as of the
// Next version pinned in package.json) — runs once per server/edge
// runtime instance at boot, dispatching to whichever of the two configs
// below actually matches. Browser-side init lives separately in
// instrumentation-client.ts — this file never runs in the browser.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures an error surfaced through Next.js's own request-error
// reporting (e.g. a thrown error in a Server Component render) that
// wouldn't otherwise reach a try/catch this app controls.
export const onRequestError = Sentry.captureRequestError;
