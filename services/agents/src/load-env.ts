// Loads the repo-root .env for local dev (`pnpm dev`) — without it this
// service calls the backend on its default port and has no
// AGENT_SERVICE_INTERNAL_KEY. Same job as apps/backend/src/load-env.ts,
// using Node's own loader since this service doesn't depend on dotenv.
// src/ and dist/ both sit directly under services/agents. Variables
// already set in the environment are left untouched, and a missing file
// (any deployed container) is ignored.
import { resolve } from "path";

try {
  process.loadEnvFile(resolve(__dirname, "../../../.env"));
} catch {
  // No .env — the environment is configured some other way.
}
