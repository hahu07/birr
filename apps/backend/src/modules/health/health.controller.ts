import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { Public } from "../../common/guards/public.decorator";
import { jobHealth } from "../../common/jobs/job-monitor";

/**
 * Liveness/readiness probe for a load balancer or orchestrator — no
 * such endpoint existed anywhere in this codebase before. @Public()
 * since a health check must be reachable with no session (that's the
 * whole point — an unauthenticated infra check, not an API route).
 * Checks real DB connectivity (not just "the process is running") since
 * a backend that's up but can't reach Postgres is exactly the case a
 * load balancer needs to detect and route around.
 */
@Public()
@Controller("health")
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  async check() {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        detail: "Database unreachable.",
      });
    }
    return { status: "ok" };
  }

  /**
   * For an external uptime monitor (2026-11-16): 503 while any scheduled
   * job is overdue (stopped, or never succeeded) or its last run failed —
   * monthly charges, reconciliation, the daily checks and the database
   * backup. Kept apart from GET /health, which an orchestrator uses to
   * decide whether to restart the server: a failing job isn't a reason to
   * restart a healthy one. Names jobs only; details are in Ops → System
   * health.
   */
  @Get("jobs")
  async jobs() {
    const health = (await jobHealth()).filter((j) => j.public);
    const overdue = health.filter((j) => j.overdue).map((j) => j.job);
    const failing = health.filter((j) => j.failing).map((j) => j.job);
    if (overdue.length || failing.length) {
      throw new ServiceUnavailableException({ status: "degraded", overdue, failing });
    }
    return { status: "ok" };
  }
}
