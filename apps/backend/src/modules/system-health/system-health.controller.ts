import { Controller, Get } from "@nestjs/common";
import { prisma } from "@birr/db";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { jobHealth } from "../../common/jobs/job-monitor";

/**
 * Ops → System health (2026-11-16): every scheduled job's last run, last
 * success, when it's next due, and recent failures with their error.
 * Platform admins only (system.health_view) — they run the platform; the
 * same failures reach them in the app as they happen.
 */
@Controller("system")
export class SystemHealthController {
  @Get("health")
  @RequiresAccess("system.health_view")
  async health() {
    const [jobs, recentFailures] = await Promise.all([
      jobHealth(),
      prisma.jobRun.findMany({ where: { status: "failed" }, orderBy: { startedAt: "desc" }, take: 20 }),
    ]);
    return { checkedAt: new Date(), jobs, recentFailures };
  }
}
