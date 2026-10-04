import { defineConfig, devices } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// A real local run needs the same secrets (JWT_SECRET, DATABASE_URL,
// SETTINGS_ENCRYPTION_KEY, etc.) `pnpm dev` already needs — those live
// in the repo-root .env, which this config loads directly rather than
// depending on the invoking shell having sourced it (this suite's own
// webServer entries spawn backend/web as fresh child processes, which
// only inherit what's actually in process.env at that point). CI sets
// these as real environment/secrets instead and has no .env file to
// find, so a missing file here is a no-op, not an error. Deliberately
// not `dotenv` (an extra dependency for a few flat KEY=VALUE lines) —
// and deliberately never overwrites a variable the environment already
// set, so CI-provided secrets always win over anything a stray local
// .env might also define.
function loadRootEnvIfPresent() {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
loadRootEnvIfPresent();

// Dedicated ports, distinct from every other dev-server convention in
// this repo (.claude/launch.json's own backend/web at 4001/3001, the
// plain `pnpm dev` defaults at 4000/3000, the agent service's default
// at 4100) — so this suite's own webServer processes below never
// collide with a developer's already-running local servers.
const WEB_PORT = process.env.E2E_WEB_PORT ?? "3100";
const BACKEND_PORT = process.env.E2E_BACKEND_PORT ?? "4150";
const BASE_URL = `http://localhost:${WEB_PORT}`;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

// CI (see .github/workflows/ci.yml's own e2e-test job) always starts
// both servers fresh against a freshly migrated+seeded database — never
// reuses a stray leftover process. Locally, reuseExistingServer lets a
// developer `pnpm --filter @birr/web e2e` repeatedly against servers
// they're already running via this same config without a slow
// restart each time.
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Next dev's Turbopack compiles each route lazily on its first visit
  // — a route this run has never hit yet (not just the server itself)
  // can take 15-20s+ to compile before the first interactive element
  // appears, independent of whether the webServer health check above
  // already passed. The default 30s per-test timeout was observed
  // failing on exactly that first-compile cost, not a real app issue.
  timeout: 60_000,
  // Single worker — fixtures in e2e/fixtures/seed.ts write real rows via
  // a shared Prisma connection; running specs concurrently would be a
  // second, DB-level source of the exact cross-test interference this
  // codebase's own backend Jest specs already warn about (see
  // vault-contributions.service.spec.ts and friends) for no real speed
  // win at this suite's current size.
  workers: 1,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @birr/backend dev",
      // `url` alone (not `port`) — Playwright 1.63 rejects a webServer
      // entry that specifies both.
      url: `${BACKEND_URL}/health`,
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: {
        BACKEND_PORT,
        // Without this, FoundersController.verifyEmail redirects to its
        // own http://localhost:3000 default — a dead address in this
        // suite (BASE_URL is 3100) — so a browser-driven verify-email
        // test would hit ERR_CONNECTION_REFUSED on the redirect instead
        // of landing on this suite's own /verified page.
        FOUNDER_PORTAL_URL: BASE_URL,
        // /founders/login, /founders/login/mfa, /birr-staff/login, and
        // /birr-staff/login/mfa are real production rate limits (10 per
        // 10 min each — see common/auth/login-throttle.ts's own
        // comment). This suite's own many independently-authenticated
        // maker/checker logins across its spec files legitimately
        // exceed that within one run. Setting it here (not duplicated
        // in ci.yml's own e2e-test job) is enough for both: this
        // webServer env is merged into the backend process Playwright
        // spawns regardless of who invokes `playwright test`, local run
        // or CI. Never set in production.
        AUTH_LOGIN_THROTTLE_LIMIT: "100",
      },
    },
    {
      // @birr/web's own dev script already reads WEB_PORT (`next dev -p
      // ${WEB_PORT:-3000}`) — no separate --port flag needed here.
      command: "pnpm --filter @birr/web dev",
      url: BASE_URL,
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: {
        WEB_PORT,
        NEXT_PUBLIC_BACKEND_URL: BACKEND_URL,
      },
    },
  ],
});

export { BACKEND_URL };
