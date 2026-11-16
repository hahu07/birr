#!/usr/bin/env bash
# Daily encrypted backup of Birr's Postgres database (2026-11-16).
# See docs/monitoring-and-recovery.md.
#
# Run from cron as a user that can read DATABASE_URL, e.g.:
#   15 2 * * *  cd /opt/birr && ./scripts/backup-postgres.sh >> /var/log/birr-backup.log 2>&1
#
# Each run records itself in the job_runs table (job "database_backup"),
# so a failed or missed backup shows in Ops → System health and fails
# GET /health/jobs, the same as any scheduled job inside the app.
#
# Environment:
#   DATABASE_URL           the database to back up (an owner role); required
#   BACKUP_GPG_RECIPIENT   GPG public key (id or email) to encrypt to; required.
#                          Only the matching private key, kept off this server,
#                          can decrypt — this server can't read its own backups.
#   BACKUP_ALLOW_UNENCRYPTED=1  local testing only: keep the dump unencrypted
#   BACKUP_DIR             where copies are kept (default /var/backups/birr)
#   BACKUP_KEEP_DAYS       local copies older than this are deleted (default 14)
#   BACKUP_RCLONE_REMOTE   optional off-site copy, e.g. "b2:birr-backups/db"
#   PG_DUMP, PSQL          the Postgres client tools (default: from PATH;
#                          use the same major version as the server)
set -Eeuo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the database to back up.}"
# libpq doesn't accept Prisma's ?schema= parameter.
PGURL="${DATABASE_URL%%\?*}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/birr}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
REMOTE="${BACKUP_RCLONE_REMOTE:-}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PSQL="${PSQL:-psql}"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

record() { # status error detail
  "$PSQL" "$PGURL" -v ON_ERROR_STOP=1 -q -v status="$1" -v err="$2" -v detail="$3" -v started="$STARTED" <<'SQL' ||
INSERT INTO job_runs (id, job, status, "startedAt", "finishedAt", error, detail)
VALUES (gen_random_uuid()::text, 'database_backup', :'status', :'started'::timestamptz, now(), NULLIF(:'err', ''), NULLIF(:'detail', ''));
SQL
    echo "WARNING: couldn't record this backup run in job_runs." >&2
}

fail() {
  echo "$(date -u +%FT%TZ) BACKUP FAILED: $1" >&2
  record failed "$1" ""
  exit 1
}
trap 'fail "line $LINENO: ${BASH_COMMAND}"' ERR

if [[ -z "$RECIPIENT" && "${BACKUP_ALLOW_UNENCRYPTED:-}" != "1" ]]; then
  fail "BACKUP_GPG_RECIPIENT is not set; refusing to write an unencrypted backup."
fi

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$BACKUP_DIR/birr-$STAMP.dump"

"$PG_DUMP" --format=custom --no-password "$PGURL" > "$DUMP"
[[ -s "$DUMP" ]] || fail "pg_dump produced an empty file."

if [[ -n "$RECIPIENT" ]]; then
  gpg --batch --yes --trust-model always --encrypt --recipient "$RECIPIENT" --output "$DUMP.gpg" "$DUMP"
  rm -f "$DUMP"
  FINAL="$DUMP.gpg"
else
  echo "WARNING: BACKUP_ALLOW_UNENCRYPTED=1 — this backup is NOT encrypted. Never use this outside local testing." >&2
  FINAL="$DUMP"
fi

(cd "$BACKUP_DIR" && sha256sum "$(basename "$FINAL")" > "$(basename "$FINAL").sha256")

if [[ -n "$REMOTE" ]]; then
  rclone copy "$FINAL" "$REMOTE" && rclone copy "$FINAL.sha256" "$REMOTE"
fi

find "$BACKUP_DIR" -maxdepth 1 -name 'birr-*.dump*' -mtime +"$KEEP_DAYS" -delete

SIZE="$(du -h "$FINAL" | cut -f1)"
DETAIL="$(basename "$FINAL"), $SIZE${REMOTE:+, copied to $REMOTE}"
record succeeded "" "$DETAIL"
echo "$(date -u +%FT%TZ) Backup done: $DETAIL"
