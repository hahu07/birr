# Monitoring and recovery

How Birr notices when something stops working, and how to get the data back.
Set all of this up before real money arrives.

## What's watched

| What | How often it must succeed | Where it runs |
| --- | --- | --- |
| Monthly giving: charges, retries, reminders | hourly | in the backend |
| Daily Paystack reconciliation (checked hourly) | hourly | in the backend |
| Portfolio drift check | daily | in the backend |
| Trustee licence expiry check | daily | in the backend |
| Access review reminder | daily | in the backend |
| Database backup | daily | `scripts/backup-postgres.sh` (cron) |
| Restore drill | monthly | `scripts/restore-check.sh` (by hand) |

Every run is recorded in the `job_runs` table: start, finish, and success or failure.

**A job is overdue** when it hasn't succeeded within twice its interval plus some slack, or has never succeeded.

**When a job inside the backend fails:**
- its error goes to **Sentry**, tagged with the job;
- **platform admins get a notice in the Ops Console** (at most once every 6 hours per job).

**The backup and the drill** report in from outside the app, so a failure there shows in System health and fails `/health/jobs`.

## Where you see it

- **Ops Console → Admin → System health** (platform admins): every job's last success, when it's next due, and recent failures with their error.
- **`GET /health`:** the server is up and can reach the database. Your host uses this to decide whether to restart the server.
- **`GET /health/jobs`:** `200 {"status":"ok"}`, or `503` with the job names that are overdue or failing. The restore drill isn't included.

## Set up once

1. **Sentry.** Create a Sentry project for the backend and set `SENTRY_DSN` in the backend's environment. Without it, errors are only logged.
2. **An uptime monitor** (UptimeRobot, Better Stack or similar), checking every 5 minutes and alerting by email and SMS or WhatsApp:
   - `https://<backend>/health`: is the server up?
   - `https://<backend>/health/jobs`: is every job on time?

   This is what catches the whole server being down, which nothing inside the server can report.
3. **A backup key pair.**
   - Make a GPG key pair on a trusted computer (not the server):
     ```
     gpg --quick-gen-key "Birr backups <backups@your-domain>"
     ```
   - Export only the **public** key to the server:
     ```
     gpg --export --armor backups@your-domain > birr-backups.pub
     ```
     Import it on the server with `gpg --import`.
   - Keep the **private** key off the server, backed up in two safe places (for example, a password manager and an encrypted USB drive kept by a trustee). **Without it, no backup can be restored.**
4. **The daily backup.** On the server, with `postgresql-client` of the same major version as the database:
   ```
   # /etc/cron.d/birr-backup
   15 2 * * * birr cd /opt/birr && DATABASE_URL=... BACKUP_GPG_RECIPIENT=backups@your-domain BACKUP_RCLONE_REMOTE=offsite:birr-backups ./scripts/backup-postgres.sh >> /var/log/birr-backup.log 2>&1
   ```
   - `BACKUP_RCLONE_REMOTE` copies each backup off the server. Set up a remote with `rclone config`: an S3, Backblaze B2 or Google Drive bucket, ideally with versioning or object lock.
   - Local copies are kept 14 days (`BACKUP_KEEP_DAYS`).
   - On a managed database (for example Render Postgres), keep the provider's own backups switched on *as well*. This script gives you a copy you control.

## The monthly restore drill

A backup nobody has tried to restore isn't a backup. Once a month:

1. On the trusted computer that holds the private key, with Postgres running locally (for example `docker run -e POSTGRES_PASSWORD=x -p 5499:5432 postgres:16`), fetch the latest backup and its `.sha256` file.
2. Run the drill:
   ```
   ADMIN_DATABASE_URL=postgresql://postgres:x@localhost:5499/postgres \
   RECORD_DATABASE_URL=<production DATABASE_URL> \
     ./scripts/restore-check.sh birr-<date>.dump.gpg
   ```
3. **The drill checks** that:
   - the checksum matches;
   - the restore succeeds;
   - the audit trail's hash chain verifies;
   - the core tables (roles, permissions, users, staff) aren't empty.

   It also reports the money records and which migration the backup is at. The scratch database is then dropped. With `RECORD_DATABASE_URL` set, System health shows the drill was done.
4. **If it fails, treat it as an incident:**
   - **Checksum mismatch:** the file is damaged; try the previous day's backup and the off-site copy.
   - **Restore errors:** check the Postgres client and server versions match.
   - **Audit chain doesn't verify:** stop and investigate. The audit trail is meant to be impossible to rewrite. (In a development database, rows broken by old test clean-up are known; see CLAUDE.md, 2026-11-15.)

## Restoring for real

1. Stop the backend, so nothing writes during the restore.
2. Decrypt the chosen backup on the trusted computer:
   ```
   gpg --decrypt birr-<date>.dump.gpg > birr.dump
   ```
3. Restore it into a **new, empty** database as the owner role:
   ```
   pg_restore --no-owner --dbname <new database URL> birr.dump
   ```
   Then rerun the grants the app role needs (`packages/db/prisma/migrations/20260831180000_add_birr_app_runtime_role`).
4. Run the restore drill's checks against it, then point the backend's `DATABASE_URL` at it and start the backend.
5. Anything paid after the backup was taken is reconciled from Paystack: run the reconciliation for those days and resolve each flagged item.
6. Write down what happened, when, and who did it. Two people should do a real restore.
