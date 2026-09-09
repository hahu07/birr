# services/agents — the Claude Agent SDK service (Rasid/Nazim's
# scheduled runs, Rafiq's on-demand draft-help HTTP endpoint). Deployed
# as a private service (no public endpoint — see src/server.ts's own
# comment on why it's internal-only). Built from the monorepo root as
# context: `docker build -f services/agents/Dockerfile .`
#
# Same turbo-prune pattern as apps/backend/Dockerfile and
# apps/web/Dockerfile — see those files' comments for why (minimal
# correctly-scoped install, tsconfig.base.json copied explicitly since
# turbo prune doesn't carry repo-root files outside any package).
#
# Pinned to 22.20.0, not the floating `22-slim` tag — see
# apps/backend/Dockerfile's comment: that tag currently resolves to a
# build with a 0-byte npm package.json, breaking every npx/npm
# invocation including `turbo prune` below.

FROM node:22.20.0-slim AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @birr/agents --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
# @birr/agents doesn't run migrations or write to the DB directly (see
# src/index.ts's own comment — everything goes through the backend API)
# and nothing in src/ currently imports @birr/db at all — but it's a
# declared dependency, and @birr/db's main entry (dist/index.js) doesn't
# exist until its own `tsc` build runs, so the moment something here
# does start importing it, skipping this step would produce the exact
# MODULE_NOT_FOUND apps/backend/Dockerfile's own comment on this
# describes. Building it now costs nothing and closes that off.
RUN pnpm --filter @birr/db exec prisma generate
RUN pnpm --filter @birr/db build
RUN pnpm --filter @birr/agents build

# ---- Runtime image ----
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 agents
COPY --from=installer --chown=agents:nodejs /app .
USER agents
ENV NODE_ENV=production
EXPOSE 4100
CMD ["node", "services/agents/dist/index.js"]
