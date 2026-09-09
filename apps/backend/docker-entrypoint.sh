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
fi

exec "$@"
