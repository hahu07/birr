#!/usr/bin/env bash
# Monthly restore drill (2026-11-16): proves a backup can actually be
# restored, by restoring it into a scratch database and checking it.
# See docs/monitoring-and-recovery.md.
#
#   ./scripts/restore-check.sh /path/to/birr-20261116T021500Z.dump.gpg
#
# Run where the backup's private GPG key is (never on the production
# server), against a Postgres you can create databases on — a local one,
# NOT production. The scratch database is dropped at the end.
#
# Checks: the checksum matches; the restore succeeds; the audit trail's
# hash chain verifies (audit_logs_verify_chain() finds no broken link);
# core tables aren't empty; and which migration the backup is at, against
# the newest one in this checkout (a backup older than the code is normal,
# so that one is reported, not failed).
#
# Environment:
#   ADMIN_DATABASE_URL   a Postgres to restore into, as a role that can
#                        CREATE DATABASE; required
#   RECORD_DATABASE_URL  optional: also record the drill as job "restore_check"
#                        in that database, so System health shows it was done
#   PSQL, PG_RESTORE     the Postgres client tools (default: from PATH)
set -Eeuo pipefail

BACKUP="${1:?Usage: restore-check.sh <backup file (.dump or .dump.gpg)>}"
: "${ADMIN_DATABASE_URL:?Set ADMIN_DATABASE_URL to a Postgres you can create a scratch database on (not production).}"
ADMIN_URL="${ADMIN_DATABASE_URL%%\?*}"
PSQL="${PSQL:-psql}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="birr_restore_check_$(date +%s)"
SCRATCH_URL="${ADMIN_URL%/*}/$SCRATCH"
WORK="$(mktemp -d)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FAILED=()

cleanup() {
  "$PSQL" "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

check() { # name ok? message
  if [[ "$2" == "ok" ]]; then echo "  ✓ $1: $3"; else echo "  ✗ $1: $3"; FAILED+=("$1: $3"); fi
}

echo "Restore drill for $(basename "$BACKUP")"

if [[ -f "$BACKUP.sha256" ]]; then
  if (cd "$(dirname "$BACKUP")" && sha256sum --check --status "$(basename "$BACKUP").sha256"); then
    check "checksum" ok "matches"
  else
    check "checksum" fail "does NOT match — the file is damaged or was changed"
  fi
else
  check "checksum" fail "no $(basename "$BACKUP").sha256 next to the backup"
fi

DUMP="$BACKUP"
if [[ "$BACKUP" == *.gpg ]]; then
  DUMP="$WORK/backup.dump"
  gpg --batch --quiet --decrypt --output "$DUMP" "$BACKUP"
fi

"$PSQL" "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH\"" >/dev/null
if "$PG_RESTORE" --no-owner --no-privileges --exit-on-error --dbname "$SCRATCH_URL" < "$DUMP" 2> "$WORK/restore.log"; then
  check "restore" ok "into scratch database $SCRATCH"
else
  check "restore" fail "pg_restore failed: $(tail -n 3 "$WORK/restore.log" | tr '\n' ' ')"
fi

q() { "$PSQL" "$SCRATCH_URL" -At -v ON_ERROR_STOP=1 -c "$1"; }

if [[ ${#FAILED[@]} -eq 0 || ! " ${FAILED[*]} " =~ " restore:" ]]; then
  BROKEN="$(q "SELECT count(*) FROM audit_logs_verify_chain()")"
  ROWS="$(q "SELECT count(*) FROM audit_logs")"
  if [[ "$BROKEN" == "0" ]]; then check "audit chain" ok "$ROWS rows, every link verifies"
  else check "audit chain" fail "$BROKEN of $ROWS rows don't verify (see audit_logs_verify_chain())"; fi

  for table in roles permissions role_permissions users birr_staff; do
    n="$(q "SELECT count(*) FROM $table")"
    if [[ "$n" -gt 0 ]]; then check "$table" ok "$n rows"; else check "$table" fail "empty"; fi
  done
  echo "  · money records: $(q "SELECT (SELECT count(*) FROM contributions) || ' contributions, ' || (SELECT count(*) FROM vault_contributions) || ' vault gifts, ' || (SELECT count(*) FROM zakah_payments) || ' zakah payments'")"

  AT="$(q "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1")"
  NEWEST="$(find "$REPO/packages/db/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -name '2*' -printf '%f\n' | sort | tail -n 1)"
  if [[ "$AT" == "$NEWEST" ]]; then echo "  · migrations: at $AT, the newest in this checkout"
  else echo "  · migrations: backup at $AT; this checkout's newest is $NEWEST (fine if the backup predates it)"; fi
fi

if [[ -n "${RECORD_DATABASE_URL:-}" ]]; then
  STATUS="succeeded"; ERR=""
  if [[ ${#FAILED[@]} -gt 0 ]]; then STATUS="failed"; ERR="$(IFS='; '; echo "${FAILED[*]}")"; fi
  "$PSQL" "${RECORD_DATABASE_URL%%\?*}" -q -v ON_ERROR_STOP=1 -v status="$STATUS" -v err="$ERR" -v detail="$(basename "$BACKUP")" -v started="$STARTED" <<'SQL'
INSERT INTO job_runs (id, job, status, "startedAt", "finishedAt", error, detail)
VALUES (gen_random_uuid()::text, 'restore_check', :'status', :'started'::timestamptz, now(), NULLIF(:'err', ''), NULLIF(:'detail', ''));
SQL
fi

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "RESTORE DRILL FAILED (${#FAILED[@]}):"
  printf '  - %s\n' "${FAILED[@]}"
  exit 1
fi
echo "Restore drill passed."
