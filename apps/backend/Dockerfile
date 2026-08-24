# apps/backend — the NestJS API both Next.js frontends and the agent
# service call (see CLAUDE.md's Tech Stack section for why this is
# standalone rather than living inside either frontend). Built from the
# monorepo root as context: `docker build -f apps/backend/Dockerfile .`
#
# Uses `turbo prune` to produce a minimal, correctly-scoped subset of
# this pnpm workspace (this app + @birr/db, its only real dependency)
# before installing — the standard pattern for a turborepo monorepo,
# avoiding a hand-rolled pnpm --filter install that's easy to get subtly
# wrong as new workspace packages are added.
#
# node:22.20.0-slim (Debian), not -alpine — Prisma's query engine needs a
# binary target matching the runtime's libc; Alpine's musl libc requires
# an explicit `binaryTargets` entry in schema.prisma to get right, which
# this schema doesn't have. Debian-slim uses glibc, same as Prisma's
# "native" default, so nothing extra is needed here.
#
# Pinned to a specific patch version rather than the floating `22-slim`
# tag: that tag currently resolves to a broken image (npm's own
# package.json ships as a 0-byte file, breaking every npx/npm
# invocation including `turbo prune` below) — confirmed reproducible on
# a forced fresh pull, so it's an upstream defect, not local corruption.
# 22.20.0 is a verified-good build; re-check before bumping.

FROM node:22.20.0-slim AS base
# `corepack enable` alone only installs shims that download the pinned
# package manager version on first invocation, into a cache keyed off
# $HOME — fine as root, but corepack derives the cache path from
# whichever user invokes it, so the runner stage's non-root `nestjs`
# user (see below) would try to create its own cache and fail with
# EACCES the moment migrate/seed invoke pnpm at runtime, even after a
# `corepack prepare` done as root — that populated *root's* cache, not
# one nestjs can see. Fixing this by pointing COREPACK_HOME at a
# world-writable path, prepared once here, that both root (build) and
# nestjs (runtime) resolve to identically.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate && chmod -R go+rwX /opt/corepack

# ---- Prune the workspace down to just this app + its deps ----
FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @birr/backend --docker

# ---- Install deps (cached separately from source for faster rebuilds) ----
FROM base AS installer
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# turbo prune only copies each included package's own files, not
# repo-root files that live outside any package — tsconfig.base.json is
# exactly that (every app's tsconfig extends it via a relative "../../"
# path). Without it, the extends silently fails to resolve and
# TypeScript falls back to esModuleInterop:false/skipLibCheck:false,
# which floods the build with spurious `export =` interop errors from
# third-party .d.ts files (twilio's, specifically) that skipLibCheck
# would otherwise suppress. Caught by actually running this build, not
# assumed — see this Dockerfile's own build history if this regresses.
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
# The Prisma client @birr/db exports has to be generated before the
# backend's own build can type-check against it — turbo's build task
# depends on `^build`, but @birr/db has no build script (see its own
# package.json), only `generate`, so this can't be left implicit.
RUN pnpm --filter @birr/db exec prisma generate
RUN pnpm --filter @birr/backend build

# ---- Runtime image ----
FROM base AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=installer --chown=nestjs:nodejs /app .
USER nestjs
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "apps/backend/dist/main.js"]
