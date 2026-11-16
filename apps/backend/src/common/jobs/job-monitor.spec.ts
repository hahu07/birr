import { prisma } from "@birr/db";

jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }));
import * as Sentry from "@sentry/nestjs";
import * as monitor from "./job-monitor";
import { JOBS, assessJob, configureJobMonitor, pruneJobRuns, runMonitoredJob } from "./job-monitor";
import { HealthController } from "../../modules/health/health.controller";
import { createFakeNotificationsService } from "../../modules/notifications/test-support/fake-notifications-service";

// Scheduled jobs are recorded and watched (2026-11-16), so one that fails or
// quietly stops shows up instead of only in a log.
describe("job monitor", () => {
  const HOUR = 60 * 60 * 1000;
  const startedSince = new Date();

  beforeAll(() => {
    configureJobMonitor({ notifications: createFakeNotificationsService() });
  });

  afterAll(async () => {
    await prisma.jobRun.deleteMany({ where: { startedAt: { gte: startedSince } } });
    await prisma.notification.deleteMany({ where: { type: "system.job_failed", createdAt: { gte: startedSince } } });
    await prisma.$disconnect();
  });

  test("a run that works is recorded as succeeded, with its detail", async () => {
    expect(await runMonitoredJob("portfolio_drift", async () => "3 targets checked")).toBe(true);
    const run = await prisma.jobRun.findFirstOrThrow({ where: { job: "portfolio_drift", startedAt: { gte: startedSince } }, orderBy: { startedAt: "desc" } });
    expect(run).toMatchObject({ status: "succeeded", detail: "3 targets checked", error: null });
    expect(run.finishedAt).not.toBeNull();
  });

  test("a failure never throws: it's recorded, sent to Sentry, and tells platform admins once per window", async () => {
    const boom = new Error("Paystack timed out");
    expect(await runMonitoredJob("payment_reconciliation", async () => Promise.reject(boom))).toBe(false);
    const run = await prisma.jobRun.findFirstOrThrow({ where: { job: "payment_reconciliation", startedAt: { gte: startedSince } }, orderBy: { startedAt: "desc" } });
    expect(run).toMatchObject({ status: "failed", error: "Paystack timed out" });
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, { tags: { job: "payment_reconciliation" } });

    const alerts = () => prisma.notification.count({ where: { type: "system.job_failed", relatedEntityId: "payment_reconciliation", createdAt: { gte: startedSince } } });
    const first = await alerts();
    const admins = await prisma.birrStaff.count({ where: { status: "active", roles: { some: { role: "platform_admin" } } } });
    expect(first).toBe(admins);
    // A second failure within six hours doesn't alert again.
    await runMonitoredJob("payment_reconciliation", async () => Promise.reject(new Error("again")));
    expect(await alerts()).toBe(first);
  }, 60000);

  describe("overdue and failing", () => {
    const run = (status: string, hoursAgo: number, error: string | null = null) => ({ status, startedAt: new Date(Date.now() - hoursAgo * HOUR), finishedAt: null, error });
    const now = new Date();

    test("a job that has never succeeded is overdue", () => {
      expect(assessJob("monthly_giving", { lastRun: null, lastSuccess: null, lastFailure: null }, now)).toMatchObject({ overdue: true, failing: false });
    });

    test("an hourly job is due again within twice its interval plus an hour's slack", () => {
      const fine = assessJob("monthly_giving", { lastRun: run("succeeded", 2.5), lastSuccess: run("succeeded", 2.5), lastFailure: null }, now);
      expect(fine.overdue).toBe(false);
      const late = assessJob("monthly_giving", { lastRun: run("succeeded", 3.5), lastSuccess: run("succeeded", 3.5), lastFailure: null }, now);
      expect(late.overdue).toBe(true);
    });

    test("the last run failing marks it failing, even when it isn't overdue yet", () => {
      const job = assessJob("database_backup", { lastRun: run("failed", 1, "disk full"), lastSuccess: run("succeeded", 20), lastFailure: run("failed", 1, "disk full") }, now);
      expect(job).toMatchObject({ overdue: false, failing: true, lastFailure: { error: "disk full" } });
    });

    test("the restore drill is monthly and isn't part of the public check", () => {
      expect(JOBS.restore_check.public).toBe(false);
      expect(assessJob("restore_check", { lastRun: run("succeeded", 24 * 20), lastSuccess: run("succeeded", 24 * 20), lastFailure: null }, now).overdue).toBe(false);
    });
  });

  test("runs older than 90 days are pruned; recent ones stay", async () => {
    const old = await prisma.jobRun.create({ data: { job: "portfolio_drift", status: "succeeded", startedAt: new Date(Date.now() - 91 * 24 * HOUR) } });
    const recent = await prisma.jobRun.create({ data: { job: "portfolio_drift", status: "succeeded" } });
    await pruneJobRuns();
    expect(await prisma.jobRun.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.jobRun.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });

  test("the database refuses a status outside running, succeeded and failed", async () => {
    await expect(prisma.jobRun.create({ data: { job: "portfolio_drift", status: "done" } })).rejects.toThrow(/job_runs_status/);
  });

  test("GET /health/jobs is 503 naming what's wrong, ignores the monthly drill, and is 200 when all is well", async () => {
    const controller = new HealthController();
    const health = (job: string, overdue: boolean, failing: boolean, isPublic = true) => ({ job, public: isPublic, overdue, failing });
    const spy = jest.spyOn(monitor, "jobHealth");
    try {
      spy.mockResolvedValueOnce([health("monthly_giving", false, true), health("database_backup", true, false), health("restore_check", true, true, false)] as never);
      await expect(controller.jobs()).rejects.toMatchObject({
        response: { status: "degraded", overdue: ["database_backup"], failing: ["monthly_giving"] },
        status: 503,
      });
      spy.mockResolvedValueOnce([health("monthly_giving", false, false), health("restore_check", true, false, false)] as never);
      await expect(controller.jobs()).resolves.toEqual({ status: "ok" });
    } finally {
      spy.mockRestore();
    }
  });
});
