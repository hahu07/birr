# apps/web — the merged Founder Portal + Ops Console Next.js app (see
# the founder-portal/ops-console merge plan for why these two live in
# one deployment: app/(founder) and app/ops are separate route groups
# inside it, each with its own session provider). Built from the
# monorepo root as context: `docker build -f apps/web/Dockerfile .`
#
# Same turbo-prune pattern as apps/backend/Dockerfile — see that file's
# comments for why (minimal correctly-scoped install) and for the
# tsconfig.base.json gotcha (turbo prune doesn't copy repo-root files
# outside any package, so it's copied explicitly below too).
#
# Pinned to 22.20.0 rather than the floating `22-slim` tag — see
# apps/backend/Dockerfile's comment on this: that tag currently
# resolves to a build with a 0-byte npm package.json, breaking every
# npx/npm invocation.

FROM node:22.20.0-slim AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @birr/web --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
# NEXT_PUBLIC_* vars are baked into the client bundle at build time, not
# read at runtime — real deployments must pass the real backend URL
# here via --build-arg, not just at `docker run`.
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
RUN pnpm --filter @birr/web build

# ---- Runtime image ----
# Next's standalone output (see next.config.mjs's output: "standalone")
# bundles only the node_modules subset this app needs, plus a server.js
# entrypoint — static assets and public/ aren't included automatically
# and are copied in separately below.
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
USER nextjs
ENV NODE_ENV=production
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
