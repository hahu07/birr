import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { prisma } from "@birr/db";
import { AuditLogsService } from "./audit-logs.service";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { Public } from "../../common/guards/public.decorator";

const PAGE_SIZE = 50;


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

  // Founder-facing — 2026-09-14, found missing entirely during a
  // comprehensive Founder-side review: the list() route above already
  // exists, but sits behind the default-deny SessionAuthGuard floor,
  // which resolves a Birr-staff session specifically — a Founder session
  // fails it outright, so there was no founder-reachable audit trail at
  // all despite founder_user actions being logged every step of the way
  // (allocation changes, deed signings, invitations, cause selection...).
  // @Public() here + a manual resolveFounderFromSession() call, same
  // dual-session-controller posture as FinancialReportsController.
  //
  // Scoped by actorFounderId, not waqfId — a jointly-established Waqf
  // Fund's co-founder never appears here, matching this codebase's own
  // isolation principle ("a Founder sees only... nothing about any other
  // Founder") more faithfully than a waqf-level scope would (Foundation-
  // level events like a signed deed or a sent invitation have no waqfId
  // at all, so a waqfId-scoped view would silently miss them). Every
  // teammate under this same Founder DOES show up here — they already
  // share full visibility into each other's actions everywhere else in
  // the Portal (team/page.tsx, foundations/[id]/page.tsx), so this isn't
  // a new exposure.
  //
  // Never selects before/after — same restraint
  // GovernanceActivitySection already takes on the decided-governance
  // side: a summary of *that* an action happened, not its full payload
  // (some snapshots carry a beneficiary's bank details or a deed's full
  // legal text, neither of which belongs in a scrollable activity feed).
  @Public()
  @Get("me")
  async listMine(@Req() request: Request, @Query("cursor") cursor?: string) {
    const founder = await resolveFounderFromSession(request);
    const items = await prisma.auditLog.findMany({
      where: { actorFounderId: founder.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
        actorUser: { select: { id: true, fullName: true } },
      },
    });
    const hasMore = items.length > PAGE_SIZE;
    const page = hasMore ? items.slice(0, PAGE_SIZE) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  @Get("export")
  @RequiresAccess("audit_log.export")
  async export(@CurrentBirrStaff() staff: AuthenticatedBirrStaff, @Res() res: Response, @Query("waqfId") waqfId?: string) {
    // Streamed a page at a time, never loaded whole (2026-11-17): see
    // AuditLogsService.planChainExport. The plan fixes the chain head
    // first, so this "exported" row, written next, falls after it and
    // isn't part of the file it describes.
    const filters = waqfId ? { waqfId } : undefined;
    const plan = await this.auditLogsService.planChainExport(filters);

    await this.auditLogsService.write({
      actorType: "birr_staff",
      actorUserId: staff.userId,
      action: "audit_logs.exported",
      entityType: "AuditLog",
      entityId: "chain",
      after: { totalRecords: plan.totalRecords, chainHeadSequence: plan.chainHeadSequence },
    });

    const stamp = plan.exportedAt.replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="birr-audit-log-export-${stamp}.json"`);
    res.setHeader("Cache-Control", "no-store");
    try {
      await this.auditLogsService.streamChainExport(res, plan, filters);
      res.end();
    } catch (err) {
      // Headers are already sent, so the status can't change: cut the
      // response off, and the half-written file fails to parse rather
      // than passing for a complete export.
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  }

  @Get("verify")
  @RequiresAccess("audit_log.export")
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
