import { Logger } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { prisma } from "@birr/db";
import type { NotificationsService } from "../../modules/notifications/notifications.service";
import { holdsAnyRole } from "../auth/staff-roles";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Every scheduled job, and how often it must succeed (2026-11-16). A job
 * that hasn't succeeded within twice its interval, plus slack, is overdue:
 * failing quietly, or stopped. `external` jobs report in from outside the
 * app (scripts/backup-postgres.sh, scripts/restore-check.sh). `public`
 * jobs count toward GET /health/jobs; the monthly restore drill only shows
 * in Ops.
 */
export const JOBS = {
  monthly_giving: { label: "Monthly giving: charges, retries and reminders", everyMs: HOUR, slackMs: HOUR, public: true, external: false },
  payment_reconciliation: { label: "Daily Paystack reconciliation (checked hourly)", everyMs: HOUR, slackMs: HOUR, public: true, external: false },
  portfolio_drift: { label: "Portfolio drift check", everyMs: DAY, slackMs: 6 * HOUR, public: true, external: false },
  trustee_license_expiry: { label: "Trustee licence expiry check", everyMs: DAY, slackMs: 6 * HOUR, public: true, external: false },
  counterparty_license_expiry: { label: "Counterparty licence expiry warnings", everyMs: DAY, slackMs: 6 * HOUR, public: true, external: false },
  access_review_reminder: { label: "Access review reminder", everyMs: DAY, slackMs: 6 * HOUR, public: true, external: false },
  database_backup: { label: "Database backup (scripts/backup-postgres.sh)", everyMs: DAY, slackMs: 6 * HOUR, public: true, external: true },
  restore_check: { label: "Restore drill (scripts/restore-check.sh)", everyMs: 31 * DAY, slackMs: 7 * DAY, public: false, external: true },
} as const;

export type JobKey = keyof typeof JOBS;

const logger = new Logger("JobMonitor");
/** A failing job tells platform admins at most this often. */
const ALERT_EVERY_MS = 6 * HOUR;
const KEEP_RUNS_MS = 90 * DAY;

let notifications: NotificationsService | undefined;

/** Called once at startup, so failures can reach platform admins in the app. */
export function configureJobMonitor(options: { notifications: NotificationsService }): void {
  notifications = options.notifications;
}

/**
 * Runs one tick of a scheduled job and records it: started, then succeeded
 * or failed. A failure goes to Sentry (tagged with the job) and, at most
 * once every 6 hours per job, to platform admins' bell. Never throws: a
 * scheduler keeps its interval whatever happens. Returns whether it worked.
 */
export async function runMonitoredJob(job: JobKey, fn: () => Promise<unknown>): Promise<boolean> {
  let runId: string | null = null;
  try {
    runId = (await prisma.jobRun.create({ data: { job } })).id;
  } catch (err) {
    // Recording must never stop the job itself.
    logger.error(`Couldn't record the start of ${job}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const detail = await fn();
    await finish(runId, "succeeded", null, typeof detail === "string" ? detail : null);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${JOBS[job].label} failed: ${err instanceof Error ? err.stack : message}`);
    Sentry.captureException(err, { tags: { job } });
    await finish(runId, "failed", message, null);
    await alertAdmins(job, message).catch((alertErr) =>
      logger.error(`Couldn't alert admins about ${job}: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`),
    );
    return false;
  }
}

async function finish(runId: string | null, status: "succeeded" | "failed", error: string | null, detail: string | null) {
  if (!runId) return;
  await prisma.jobRun
    .update({ where: { id: runId }, data: { status, finishedAt: new Date(), error: error?.slice(0, 2000) ?? null, detail: detail?.slice(0, 500) ?? null } })
    .catch((err) => logger.error(`Couldn't record the end of a job run: ${err instanceof Error ? err.message : String(err)}`));
}

async function alertAdmins(job: JobKey, message: string): Promise<void> {
  if (!notifications) return;
  const recent = await prisma.notification.findFirst({
    where: { type: "system.job_failed", relatedEntityId: job, createdAt: { gte: new Date(Date.now() - ALERT_EVERY_MS) } },
    select: { id: true },
  });
  if (recent) return;
  const admins = await prisma.birrStaff.findMany({ where: { status: "active", ...holdsAnyRole("platform_admin") }, select: { userId: true } });
  await Promise.all(
    admins.map((a) =>
      notifications!.notify({
        recipientType: "birr_staff",
        recipientUserId: a.userId,
        type: "system.job_failed",
        title: `Scheduled job failed: ${JOBS[job].label}`,
        body: message.slice(0, 300),
        linkUrl: "/ops/system-health",
        relatedEntityType: "Job",
        relatedEntityId: job,
      }),
    ),
  );
}

export interface JobHealth {
  job: JobKey;
  label: string;
  everyMs: number;
  external: boolean;
  public: boolean;
  lastRun: { status: string; startedAt: Date; finishedAt: Date | null; error: string | null } | null;
  lastSuccessAt: Date | null;
  lastFailure: { startedAt: Date; error: string | null } | null;
  /** When it should next have succeeded by. */
  dueBy: Date | null;
  overdue: boolean;
  failing: boolean;
}

type RunRow = { status: string; startedAt: Date; finishedAt: Date | null; error: string | null };

/** Whether one job is overdue or failing, from its latest runs. Pure, so it's tested exactly. */
export function assessJob(job: JobKey, runs: { lastRun: RunRow | null; lastSuccess: RunRow | null; lastFailure: RunRow | null }, now: Date): JobHealth {
  const spec = JOBS[job];
  const allowedMs = 2 * spec.everyMs + spec.slackMs;
  const dueBy = runs.lastSuccess ? new Date(runs.lastSuccess.startedAt.getTime() + allowedMs) : null;
  return {
    job,
    label: spec.label,
    everyMs: spec.everyMs,
    external: spec.external,
    public: spec.public,
    lastRun: runs.lastRun && { status: runs.lastRun.status, startedAt: runs.lastRun.startedAt, finishedAt: runs.lastRun.finishedAt, error: runs.lastRun.error },
    lastSuccessAt: runs.lastSuccess?.startedAt ?? null,
    lastFailure: runs.lastFailure && { startedAt: runs.lastFailure.startedAt, error: runs.lastFailure.error },
    dueBy,
    // Never succeeded counts as overdue: a job that has never worked is the case to catch.
    overdue: !dueBy || dueBy < now,
    failing: runs.lastRun?.status === "failed",
  };
}

/** Each job's latest run, latest success and latest failure, and whether it's overdue or failing. */
export async function jobHealth(now = new Date()): Promise<JobHealth[]> {
  return Promise.all(
    (Object.keys(JOBS) as JobKey[]).map(async (job) => {
      const [lastRun, lastSuccess, lastFailure] = await Promise.all([
        prisma.jobRun.findFirst({ where: { job, status: { not: "running" } }, orderBy: { startedAt: "desc" } }),
        prisma.jobRun.findFirst({ where: { job, status: "succeeded" }, orderBy: { startedAt: "desc" } }),
        prisma.jobRun.findFirst({ where: { job, status: "failed" }, orderBy: { startedAt: "desc" } }),
      ]);
      return assessJob(job, { lastRun, lastSuccess, lastFailure }, now);
    }),
  );
}

/** Drops job runs older than 90 days. */
export async function pruneJobRuns(now = new Date()): Promise<number> {
  const { count } = await prisma.jobRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - KEEP_RUNS_MS) } } });
  return count;
}
