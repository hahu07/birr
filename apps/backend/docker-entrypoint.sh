#!/bin/sh
set -e

# Render (and any other host without docker-compose's separate one-shot
# `migrate` service, see docker-compose.yml's own `migrate` service) sets
# MIGRATE_DATABASE_URL to run migrations here, using the privileged
# schema-owner role — never the app's own DATABASE_URL (birr_app), which
# deliberately lacks DDL privileges (see
# 20260831180000_add_birr_app_runtime_role/migration.sql). Unset in
# docker-compose.yml, so local dev's existing separate `migrate` service
# is unaffected by this — this block is a no-op there.
if [ -n "$MIGRATE_DATABASE_URL" ]; then
  echo "Running database migrations..."
  DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter @birr/db exec prisma migrate deploy

  # Keep the database's roles/permissions/role grants equal to
  # packages/db/prisma/seed-data.ts on every deploy — a release that adds a
  # permission (blog.publish, staff.mfa_reset, founder.mfa_reset…) is
  # broken until those rows exist, and the full seed can't be run in
  # production (it resets the bootstrap admin's password and the AI
  # agents' API keys). This touches roles/permissions only. A failure
  # stops the container, same as a failed migration, rather than starting
  # an app whose approvals silently don't work.
  echo "Syncing roles and permissions..."
  DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter @birr/db sync:permissions
fi

exec "$@"
