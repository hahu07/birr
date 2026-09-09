import { Controller, Get, Query } from "@nestjs/common";
import { prisma } from "@birr/db";
import { AuditLogsService } from "./audit-logs.service";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

const PAGE_SIZE = 50;

// The three roles CLAUDE.md's segregation-of-duties list actually gives
// a compliance/audit mandate to — not every birr_staff member should be
// able to pull the whole trustee-wide compliance evidence export.
const AUDIT_EXPORT_ROLES = ["platform_admin", "audit_committee", "external_auditor"] as const;

@Controller("audit-logs")
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  // Read-only controller — writes only ever happen via AuditLogsService
  // called from other modules (plus the export/verify actions below
  // audit-logging themselves), never a plain user-facing POST route here.
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

  @Get("export")
  @RequiresStaffRole([...AUDIT_EXPORT_ROLES])
  async export(@CurrentBirrStaff() staff: AuthenticatedBirrStaff, @Query("waqfId") waqfId?: string) {
    const result = await this.auditLogsService.exportChain(waqfId ? { waqfId } : undefined);

    await this.auditLogsService.write({
      actorType: "birr_staff",
      actorUserId: staff.userId,
      action: "audit_logs.exported",
      entityType: "AuditLog",
      entityId: "chain",
      after: { totalRecords: result.totalRecords, chainHeadSequence: result.chainHeadSequence },
    });

    return result;
  }

  @Get("verify")
  @RequiresStaffRole([...AUDIT_EXPORT_ROLES])
  async verify(@CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    const result = await this.auditLogsService.verifyChain();

    await this.auditLogsService.write({
      actorType: "birr_staff",
      actorUserId: staff.userId,
      action: "audit_logs.chain_verified",
      entityType: "AuditLog",
      entityId: "chain",
      after: { ok: result.ok, totalRecords: result.totalRecords, issueCount: result.issues.length },
    });

    return result;
  }
}
