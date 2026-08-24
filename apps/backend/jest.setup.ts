import { config } from "dotenv";
import { resolve } from "path";

// Jest's cwd is apps/backend, but the shared .env lives at the repo root —
// same DATABASE_URL-not-found issue solved for the Prisma CLI in
// packages/db (see that package's README note).
config({ path: resolve(__dirname, "../../.env"), quiet: true });
