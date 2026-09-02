import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { Public } from "../../common/guards/public.decorator";

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
}
