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
# Same build-time-bake reasoning as NEXT_PUBLIC_BACKEND_URL above —
# empty default means the browser-side Sentry init in
# instrumentation-client.ts stays a no-op until a real DSN is passed
# via --build-arg.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
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
# Next's standalone server.js defaults HOSTNAME to "localhost" (loopback
# only) when unset — invisible to any reverse proxy connecting from
# outside the container's own network namespace. Found deploying to
# Render: every boot log looked perfectly healthy (Next's own "Ready",
# Render's port-scan detecting something on 3000), yet every external
# request still 502'd, because Render's edge proxy genuinely couldn't
# reach a socket bound to 127.0.0.1. Binding to 0.0.0.0 is what makes
# the app reachable on the container's actual network interface, not
# just from inside itself.
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]
