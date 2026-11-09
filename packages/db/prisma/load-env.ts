// Loads the repo-root .env for scripts run directly with tsx (seed,
// sync-permissions, backfills). Prisma 6's client read .env by itself;
// Prisma 7's doesn't, and without DATABASE_URL these scripts would fail
// (src/index.ts refuses to create a client with no URL).
//
// Import this FIRST, before anything from "../src": that module creates
// the shared client as soon as it's loaded, so the environment must
// already be in place. Paths are relative to the working directory
// (packages/db under `pnpm --filter @birr/db ...`). Variables already set
// in the environment (CI, Docker) are left untouched.
import { config } from "dotenv";

config({ path: [".env", "../../.env"], quiet: true });
