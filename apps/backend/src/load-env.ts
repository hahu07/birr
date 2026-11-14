// Loads the repo-root .env for local dev (`pnpm dev`). Prisma 6's client
// read .env by itself; Prisma 7's doesn't, so without this the backend
// stopped at boot with "DATABASE_URL is not set" — the same gap
// packages/db/prisma/load-env.ts closes for the seed scripts.
//
// Imported by instrument.ts before anything else, so SENTRY_DSN is in
// place too. src/ and dist/ both sit directly under apps/backend, so
// one relative path works compiled or not. Variables already set in the
// environment (Docker, Render) are left untouched, and a missing file
// is ignored.
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../../.env"), quiet: true });
