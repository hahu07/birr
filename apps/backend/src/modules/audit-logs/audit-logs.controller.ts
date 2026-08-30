import { Controller, Get, Query } from "@nestjs/common";
import { prisma } from "@birr/db";

const PAGE_SIZE = 50;

@Controller("audit-logs")
export class AuditLogsController {
  // Read-only controller — writes only ever happen via AuditLogsService
  // called from other modules, never a POST route here.
  //
  // Cursor-based, not offset — id is the cursor (paired with createdAt
  // in orderBy so ties on the same millisecond stay in a stable order).
  // Before this, the route hard-capped at the most recent 100 rows with
  // no way to reach anything older; a real audit trail has to stay
  // reachable arbitrarily far back, not just "recent activity."
  @Get()
  async list(@Query("waqfId") waqfId?: string, @Query("cursor") cursor?: string) {
    const items = await prisma.auditLog.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      // Resolved for display only — never select passwordHash/apiKeyHash,
      // same principle as BirrStaffService's SAFE_USER_SELECT.
      include: {
        actorUser: { select: { id: true, fullName: true, email: true } },
        actorAgent: { select: { id: true, name: true } },
        actorFounder: { select: { id: true, name: true } },
      },
    });
    const hasMore = items.length > PAGE_SIZE;
    const page = hasMore ? items.slice(0, PAGE_SIZE) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }
}
