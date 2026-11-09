// Loaded by instrumentation.ts when NEXT_RUNTIME === "edge" — middleware
// and any edge-runtime route handlers, a separate lightweight runtime
// from sentry.server.config.ts's Node.js one. Same no-op-when-unset
// posture.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION } from "./sentry.shared";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  dataCollection: SENTRY_DATA_COLLECTION,
});
