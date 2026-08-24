import { Controller, Get, Query } from "@nestjs/common";
import { prisma } from "@birr/db";

@Controller("audit-logs")
export class AuditLogsController {
  // Read-only controller — writes only ever happen via AuditLogsService
  // called from other modules, never a POST route here.
  @Get()
  async list(@Query("waqfId") waqfId?: string) {
    return prisma.auditLog.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      // Resolved for display only — never select passwordHash/apiKeyHash,
      // same principle as BirrStaffService's SAFE_USER_SELECT.
      include: {
        actorUser: { select: { id: true, fullName: true, email: true } },
        actorAgent: { select: { id: true, name: true } },
        actorFounder: { select: { id: true, name: true } },
      },
    });
  }
}
