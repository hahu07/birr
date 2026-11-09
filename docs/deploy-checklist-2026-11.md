# Pre-deploy checklist: November 2026 dependency upgrades

What to check the next time `main` goes to Render. Covers the 20 commits
from `8e8cfeb` (homepage and Founder Portal redesign) through `0a4b84b`
(Claude Agent SDK 0.3.311).

## First: nothing from this batch has been deployed yet

- Every Render service in `render.yaml` has `autoDeploy: false`.
- The CI `deploy` job, which runs on each push to `main` once all checks
  pass, has failed on every run since at least 2026-10-03. Its log shows
  `curl -fsS -X POST ""`: the `RENDER_DEPLOY_HOOK_BACKEND`, `_WEB` and
  `_DOCS` repository secrets are empty.

So production is still on the last version someone deployed by hand. Pick one:

- **Deploy by hand** from the Render dashboard (Manual Deploy → Deploy latest
  commit) for `birr-backend`, then `birr-web`.
- **Or wire up the hooks**: copy each service's Deploy Hook URL
  (service → Settings → Deploy Hook) into the matching repository secret.
  From then on every green push to `main` deploys automatically. Decide
  this on purpose: it turns every merge into a production deploy.

## What changed

| Area | From → To | Merged in |
|---|---|---|
| Next.js | 16.3.8 → 16.4.3 (security fixes, including two remote-code-execution bugs) | #56 |
| React | 19.2.8 → 19.3.1 | #71 |
| NestJS / Express | 10 → 11 / 4 → 5 | #72 |
| Prisma | 5.22 → 6.19.3 → 7.10.1, now through the `pg` driver adapter | #73, #75 |
| Sentry | 10 → 11.9.0, with privacy defaults pinned to v10's | #76 |
| Claude Agent SDK (agents service) | 0.3.263 → 0.3.311 | #77 |
| Frontend | Homepage, Founder Portal and Ops Console redesign | #55, #74 |
| Security overrides | joi, deepmerge-ts, webpack and others; `pnpm audit --audit-level=high` is clean | #56, #57, #73 |

**No database migrations were added.** None of the Prisma upgrades needed
one. Rolling back to the previous deploy is therefore a code-only rollback.

## Before deploying

### 1. Database connection (Prisma 7)
- [ ] **TLS.** Prisma 7 verifies the database's TLS certificate, where
  Prisma 6 accepted invalid ones.
  - Look at `birr-backend`'s `DATABASE_URL` and `MIGRATE_DATABASE_URL`.
  - Render's *internal* connection strings normally connect without TLS,
    so this doesn't arise.
  - If either is an *external* URL, or carries `sslmode=require`, confirm
    its certificate verifies. If it doesn't, connections fail with
    `P1010: User was denied access`. Fix it by trusting the provider's CA
    (`NODE_EXTRA_CA_CERTS`), not by turning verification off.
- [ ] **Connection limit.** Each process now holds a pool of up to 10
  connections; Prisma 6 used CPUs × 2 + 1.
  - Count the processes that connect: the backend, plus the migration
    and permissions-sync steps that `docker-entrypoint.sh` runs before
    it starts.
  - Check that total against the `birr-postgres` plan's connection limit.
- [ ] **Environment.** `DATABASE_URL` must be set on the service. The
  database package now refuses to start without one rather than falling
  back to `localhost`. `prisma.config.ts` reads the URL from the
  environment, and no `.env` file exists in the container.

### 2. Runtime
- [ ] **Node version.** The Docker images use `node:22.20.0-slim`. That
  meets Prisma 7 (≥ 22.12), Sentry 11 (≥ 22.12) and NestJS 11 (≥ 20). No
  change is needed.
- [ ] **CORS.** `CORS_ALLOWED_ORIGINS` is set on `birr-backend` to the
  web app's real origin. It's unchanged by this batch, but is checked
  again after the Express 5 move.

### 3. Sentry
- [ ] `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are still unset, so Sentry
  stays inactive.
- [ ] When a Sentry project is connected, read the first few error
  reports. They should contain no cookies, no request bodies and no user
  info.
  - Sentry 11 collects all of these by default. Each `Sentry.init` here
    sets the restrictive `dataCollection` block to prevent it.
  - That block's effect couldn't be proven locally.

## After deploying: smoke test

Run these in order, against the deployed URLs.

- [ ] `GET /health` on the backend returns `200`. The deploy log shows
  "Running database migrations…" followed by "No pending migrations",
  then "Syncing roles and permissions…".
- [ ] The homepage loads: the new hero with the dashboard monitor, the
  Impact figures and the open Vaults.
- [ ] **Founder flow.**
  - Sign in. The dashboard shows the right totals.
  - Open a Waqf Fund and step through all five tabs.
  - Open Add funds (stop before paying).
- [ ] **Ops Console.**
  - Sign in as staff, completing the two-factor step.
  - Open Approvals, Waqf Funds (the list should page with "Show 25 more"),
    Foundations and the Audit Log.
- [ ] **One governed action end to end** (maker → checker), using two
  staff accounts. This exercises Prisma 7 interactive transactions and
  the audit-log write.
- [ ] **Payments.** Make one Paystack payment in test mode, then confirm:
  - the webhook arrives and passes its signature check (Express 5 raw body)
  - the contribution shows as confirmed
- [ ] **Files.** Upload one file and download it again, for example a
  message attachment or a vault cover.
- [ ] **Agents.** Run one on-demand agent by hand, for example Rafiq from
  Founder onboarding. This exercises the upgraded Agent SDK, and it calls
  the Claude API, so it costs a little. The `birr-agents` service is
  commented out of `render.yaml`, so this applies wherever the agents
  service actually runs.
- [ ] The backend logs show no errors during all of the above.

## If something goes wrong

- **Code rollback.** In Render, open the service → Events → choose the
  previous deploy → Rollback. Because no migrations were added, the
  database needs nothing.
- **Audit-log note.** Audit entries written while the new version runs
  store money amounts in their snapshots as exact strings (`"1000"`),
  where older entries hold numbers (`1000`). Both forms are valid. A
  rollback doesn't need to touch them, and the integrity check works on
  either.
