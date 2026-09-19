# Self-hosted production deploy on a HarmonWeb Cloud VPS (planned, not built)

Status as of 2026-09-10: **documented only** — none of the files this
describes exist yet. Written up so the plan survives between sessions;
build it when actually ready to commit to the migration.

## Why

Render's per-service billing (`birr-postgres` + `birr-backend` +
`birr-web` + `birr-agents`, roughly $28–31.50/mo total on paid tiers —
Render itself retired the old `starter` plan name for both databases and
services in the process of setting this up, see `render.yaml`'s own
comments) was raised as too expensive even for production.

HarmonWeb's Cloud VPS "Core" plan (₦18,200/mo, ~$13/mo at the September
2026 rate of ~₦1,350–1,375/$1) — confirmed directly from
https://harmonweb.com/hosting/cloud-server — gives 1 vCPU, 4GB RAM, 50GB
NVMe SSD, 10TB bandwidth, **full root access, KVM virtualization, and a
choice of OS (Ubuntu/Debian/CentOS/AlmaLinux)**. That's more combined RAM
than all four current Render resources together, for under half the
price, billed as one flat fee no matter how many containers run on it —
because it's a real VM with root access (not shared hosting), Docker
installs in minutes even though the plan page doesn't list it as a named
feature, and this repo's *existing* `docker-compose.yml` (currently
local-dev-only) is directly usable as the production topology with real
TLS/backups/deploy-automation layered on top.

This is meant to be **additive, not a cutover**: `render.yaml` and the
existing Render-based CI `deploy` job would stay untouched and working
while the new VPS path is built and verified, so nothing currently live
on Render gets turned off until the self-hosted setup is proven.

Two other options were seriously considered and set aside for now:

- **Merging Render services together** (agents into backend: reasonable,
  low risk; web into backend: rejected — collapses the deliberate
  security boundary between the lower-trust Founder-facing surface and
  the governance/DB-credential logic that CLAUDE.md documents as the
  actual point of the two-deployment split, for no real cost benefit
  since a merged container would likely need more RAM anyway).
- **Vercel** — excellent fit for `apps/web` alone, poor fit for the
  NestJS backend and the agents scheduler's `setInterval` loop (Vercel's
  serverless model has no persistent-background-process concept; would
  need Vercel Cron + a serverless adapter for NestJS + a Prisma
  connection-pooling story + a third-party Postgres like Neon — real
  re-architecture, not a drop-in host swap).
- **HarmonWeb shared/cPanel hosting for just the frontend** — genuinely
  viable (HarmonWeb documents Node.js app support via cPanel's Node
  Selector, and `apps/web` already builds as `output: "standalone"`, a
  real `node server.js`), and doesn't trade away anything since it's
  *more* separation from the backend, not less. Left as a live option
  independent of the VPS plan below — could be done instead of, or
  alongside, moving `birr-web` off Render.

## What the VPS plan builds, when it's time

**`docker-compose.prod.yml`** (repo root) — five services, reusing the
three existing Dockerfiles unchanged (`apps/backend/Dockerfile`,
`apps/web/Dockerfile`, `services/agents/Dockerfile` — already proven
correct by CI, no Dockerfile changes needed):

- `postgres` — same `postgres:16-alpine` image and named-volume pattern
  as `docker-compose.yml`'s own `postgres` service, superuser password
  from the VPS's own `.env` instead of the hardcoded dev value.
- `backend` — sets `MIGRATE_DATABASE_URL` (superuser connection) so
  `apps/backend/docker-entrypoint.sh`'s existing migrate-on-boot logic
  runs automatically. This is the exact mechanism already built for
  Render; reused as-is, no new migration-runner service. Runtime
  `DATABASE_URL` uses the restricted `birr_app` role, same as today.
  Every var from `.env.example` sourced from the VPS's `.env` via
  Compose's standard interpolation (same mechanism `docker-compose.yml`
  already uses for `JWT_SECRET`/`SETTINGS_ENCRYPTION_KEY`).
- `web` — build args `NEXT_PUBLIC_BACKEND_URL`/`NEXT_PUBLIC_SENTRY_DSN`
  set to the real public backend domain (browser-facing, not an internal
  Docker hostname — same requirement Render already has today).
- `agents` — **no published port**, reachable only via Compose's internal
  service-name DNS (`http://agents:4100`), mirroring Render's `pserv`
  (private, no public endpoint) posture for `birr-agents` exactly.
- `caddy` — reverse proxy + automatic Let's Encrypt TLS, replacing what
  Render's platform does for free today. A new **`Caddyfile`** with two
  site blocks: the frontend domain → `web:3000`, the backend/API domain →
  `backend:4000`. Needs a real domain pointed at the VPS's IP first.

**`.env.production.example`** — every var from `.env.example`, plus
`POSTGRES_SUPERUSER_PASSWORD` and the real domain values
`NEXT_PUBLIC_BACKEND_URL`/`CORS_ALLOWED_ORIGINS` need. Never committed
with real values.

**`scripts/backup-postgres.sh`** — `pg_dump` against the running
`postgres` container, compressed, uploaded off-box via an S3-compatible
CLI call (Backblaze B2/Cloudflare R2/AWS — whichever the user
configures). A backup living only on the VPS's own disk protects against
nothing; this is the piece that makes self-hosted Postgres survive a VPS
failure the way Render's managed database already does automatically.
Scheduled via a host `cron` entry.

**`scripts/deploy-vps.sh`** — `git pull`, `docker compose -f
docker-compose.prod.yml up -d --build`, prune old images. Runnable by
hand over SSH initially; a later CI job could SSH in and run this same
script (mirroring today's Render Deploy Hook curl), once `VPS_HOST`/
`VPS_SSH_KEY` exist as GitHub secrets — a manual one-time step, same
category as the Render Deploy Hook secrets already documented in
`render.yaml`'s own top comment.

**`docs/vps-deployment.md`** (a second doc, written once actually
building this) — the one-time setup narrative: provision the VPS (Docker
+ Compose install, `ufw` allowing only 22/80/443), point DNS at its IP,
first deploy, the one-time `birr_app` password rotation (identical step
to `render.yaml`'s own documented one, run via `docker compose exec
postgres psql` instead of Render's dashboard shell), scheduling the
backup cron, and wiring the optional CI auto-deploy job afterward.

## Verification, once built

1. `docker compose -f docker-compose.prod.yml config` — confirms the
   compose file parses and interpolates correctly.
2. Local dry run with real generated secrets (Sentry DSNs can stay
   empty): `docker compose -f docker-compose.prod.yml up --build`
   locally, confirm `postgres` → migrate-on-boot → `backend` health →
   `web` all come up and the frontend can reach the backend through the
   same container graph that'll run on the VPS. Caddy can't issue real
   certs for `localhost`, so this step validates `agents`/`backend`/
   `web`/`postgres` plus a `Caddyfile` syntax check (`caddy validate`)
   only — real TLS end-to-end can only be confirmed once it's actually
   running on the VPS with real DNS pointed at it.
3. Everything past that (VPS provisioning, DNS, first real deploy,
   backup cron, confirming HTTPS actually issues) is manual, on the
   user's own VPS/DNS access.
