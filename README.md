# Birr

Digital trustee platform for Islamic waqf. Start here: **CLAUDE.md** —
Claude Code reads it automatically every session; it's the source of
truth for the operating model, non-negotiables, entity list, tech stack,
and the seven agents (Rasid, Nazim, Kashif, Rashid, Rafiq, Munsif, Bashir).

For what the product actually does — the core service, who it's for,
and what's built vs. planned — see **`docs/core-service.md`**.

For exactly how the founder onboarding wizard works — the four steps,
what's gated on what, and who's allowed to do what — see
**`docs/founder-onboarding.md`**.

For the two lifecycle stages still unscoped (succession management,
long-term preservation) — what they mean and the open policy questions
before either becomes a real plan — see
**`docs/succession-and-preservation.md`**.

## Layout
- `apps/web` — merged Founder-facing (`app/(founder)`) + internal Ops
  Console (`app/ops`) Next.js app. One deployment; the two route groups
  each keep their own session provider/layout — see
  `apps/web/next.config.mjs`'s comment.
- `apps/backend` — the API both route groups and the agent service call (NestJS)
- `services/agents` — the seven agents (Claude Agent SDK)
- `packages/db` — shared Prisma schema (Postgres)

## Before you write any application code
Read `packages/db/prisma/schema.prisma` alongside `milestone-1-data-model.md`
if you have it, and these two migrations for the constraints Prisma's schema
language can't express — already applied, no separate manual step left to run:
- `prisma/migrations/20260731201431_governed_actions_constraints/migration.sql`
  — the CHECK constraints on `governed_actions` and the `audit_logs`
  UPDATE/DELETE revoke.
- `prisma/migrations/20260731202928_waqf_founder_isolation_policy/migration.sql`
  — the real `waqfs` row-level security policy (Founder isolation only —
  Birr staff access is governed by RBAC + `waqf_case_assignments`, not RLS).
  Until `apps/backend` sets `app.current_founder_id` per founder-portal
  request, no session is scoped and access is unrestricted; set that GUC
  before wiring up any founder-facing query against `waqfs`.

## Getting started
```
pnpm install
cp .env.example .env   # fill in DATABASE_URL at minimum
pnpm --filter @birr/db exec prisma migrate dev
pnpm --filter @birr/db exec prisma db seed
pnpm dev
```

Note: `prisma migrate dev` needs `DATABASE_URL` in its own process
environment, not just the repo-root `.env` — either `export` it first or run
via a tool that loads `.env` (e.g. `dotenv-cli`) before invoking the Prisma
CLI from `packages/db`.

## Running with Docker

An alternative to the above — Postgres, the backend, and the merged
frontend, each built from their own `Dockerfile` (`apps/backend`,
`apps/web`) via `docker-compose.yml` at the repo root:

```
cp .env.example .env   # fill in at least JWT_SECRET, SETTINGS_ENCRYPTION_KEY
docker compose up --build
docker compose --profile seed run --rm seed   # first run only
```

Backend on `:4000`, the web app on `:3000` (public landing/sign-in at
`/`, Ops Console sign-in at `/ops/sign-in`), Postgres on `:5432`. See
`docker-compose.yml`'s own comments for what still needs to change
before this runs anywhere but a developer's machine or an internal demo
(CORS allowlist, real secrets, TLS).
