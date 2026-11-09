// Shared by the browser, server and edge Sentry configs.
//
// Sentry v11 reversed its privacy default: with `dataCollection` unset it
// collects everything — user info, cookies (including the session
// cookie), full request/response bodies (sign-in passwords, payment
// details), database query data and AI inputs/outputs. v10 sent none of
// that unless `sendDefaultPii` was turned on, which this repo never did.
// This restores v10's behaviour explicitly, using the settings Sentry's
// v10 → v11 migration guide gives for exactly that. Loosen any of it only
// as a deliberate decision, not a default.
import type * as Sentry from "@sentry/nextjs";

export const SENTRY_DATA_COLLECTION: NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"] = {
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
};
