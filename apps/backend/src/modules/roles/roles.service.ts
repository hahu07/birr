import { BadRequestException, Injectable } from "@nestjs/common";
import { IsArray, IsOptional, IsString, MaxLength } from "class-validator";
import { createHash } from "crypto";
import { prisma } from "@birr/db";
import { checkPermissionChanges, parsePermissionChangePayload } from "./permission-changes";

/** A periodic access review is due this long after the last one (owner's decision, 2026-11-16). */
export const ACCESS_REVIEW_INTERVAL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_PAGE_SIZE = 100;

export class PreviewPermissionChangesInput {
  @IsArray()
  changes!: unknown[];
}

export class CompleteAccessReviewInput {
  @IsArray()
  outcomes!: unknown[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

type ReviewOutcome = { roleKey: string; outcome: "confirmed" | "changes_needed"; note: string | null };

/**
 * Roles & Access (Ops Console), rebuilt 2026-11-16 (owner's decisions):
 * every role's grants and the full permission catalog, who holds each
 * role, changes awaiting the Board and their history, a CSV export for
 * auditors, and the periodic access review. Open to staff managers only
 * (roles.view). The one way grants change is still the governed
 * role.permission_change (platform_admin proposes, the Board approves);
 * the database is the source of truth for grants (sync-permissions).
 */
@Injectable()
export class RolesService {
  async overview() {
    const [roles, permissions, staff] = await Promise.all([
      prisma.role.findMany({ orderBy: { name: "asc" }, include: { rolePermissions: { include: { permission: true } } } }),
      // Every permission, including any no role holds today, so it can always be granted again.
      prisma.permission.findMany({ orderBy: [{ category: "asc" }, { key: "asc" }] }),
      prisma.birrStaff.findMany({
        where: { status: "active" },
        select: { id: true, roles: { select: { role: true } }, user: { select: { fullName: true, email: true } } },
        orderBy: { user: { fullName: "asc" } },
      }),
    ]);
    const holders: Record<string, { id: string; fullName: string; email: string }[]> = {};
    for (const role of roles) holders[role.key] = [];
    for (const member of staff) {
      for (const { role } of member.roles) (holders[role] ??= []).push({ id: member.id, fullName: member.user.fullName, email: member.user.email });
    }
    return { roles, permissions, holders };
  }

  /** The guard rails run on a batch without proposing it: each change's problem, if any, and who it affects. */
  async preview(changes: unknown[]) {
    const parsed = parsePermissionChangePayload({ changes }, { requireReason: false });
    return { checks: await checkPermissionChanges(parsed.changes) };
  }

  /** Changes awaiting the Board, then decided ones, newest first. */
  async changes(page = 1) {
    const permission = await prisma.permission.findUnique({ where: { key: "role.permission_change" } });
    if (!permission) return { pending: [], history: [], page, hasMore: false };
    const select = {
      id: true,
      status: true,
      payload: true,
      createdAt: true,
      decidedAt: true,
      makerUser: { select: { fullName: true } },
      checkerUser: { select: { fullName: true } },
    } as const;
    const [pending, decided] = await Promise.all([
      prisma.governedAction.findMany({ where: { permissionId: permission.id, status: "proposed" }, orderBy: { createdAt: "desc" }, select }),
      prisma.governedAction.findMany({
        where: { permissionId: permission.id, status: { not: "proposed" } },
        orderBy: [{ decidedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * HISTORY_PAGE_SIZE,
        take: HISTORY_PAGE_SIZE + 1,
        select,
      }),
    ]);
    const present = (a: (typeof pending)[number]) => {
      const { changes, reason } = parsePermissionChangePayload(a.payload, { requireReason: false });
      return {
        id: a.id,
        status: a.status,
        changes,
        reason,
        proposedBy: a.makerUser?.fullName ?? null,
        decidedBy: a.checkerUser?.fullName ?? null,
        proposedAt: a.createdAt,
        decidedAt: a.decidedAt,
      };
    };
    return {
      pending: pending.map(present),
      history: decided.slice(0, HISTORY_PAGE_SIZE).map(present),
      page,
      hasMore: decided.length > HISTORY_PAGE_SIZE,
    };
  }

  /**
   * The full access matrix as CSV, for audit evidence: one row per role
   * and permission, with the people in the role. Who exported it, and
   * when, goes in the audit trail.
   */
  async exportCsv(actorUserId: string): Promise<{ filename: string; csv: string }> {
    const { roles, permissions, holders } = await this.overview();
    const exporter = await prisma.user.findUnique({ where: { id: actorUserId }, select: { fullName: true } });
    const now = new Date();
    const cell = (value: string | number) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [
      `# Birr access matrix, generated ${now.toISOString()} by ${exporter?.fullName ?? actorUserId}`,
      ["role", "role_name", "people_in_role", "area", "permission", "description", "type", "can_propose", "can_approve", "allowed"].join(","),
    ];
    for (const role of roles) {
      for (const permission of permissions) {
        const grant = role.rolePermissions.find((rp) => rp.permissionId === permission.id);
        const approval = permission.requiresMakerChecker;
        lines.push(
          [
            role.key,
            role.name,
            holders[role.key]?.length ?? 0,
            permission.category ?? "",
            permission.key,
            permission.description ?? "",
            approval ? "approval" : "access",
            approval ? (grant?.canMaker ? "yes" : "no") : "",
            approval ? (grant?.canChecker ? "yes" : "no") : "",
            approval ? "" : grant?.canMaker ? "yes" : "no",
          ]
            .map(cell)
            .join(","),
        );
      }
    }
    await prisma.auditLog.create({
      data: {
        actorType: "birr_staff",
        actorUserId,
        action: "roles.matrix_exported",
        entityType: "Role",
        entityId: "access-matrix",
        after: { roles: roles.length, permissions: permissions.length, exportedAt: now.toISOString() },
      },
    });
    return { filename: `birr-access-matrix-${now.toISOString().slice(0, 10)}.csv`, csv: `${lines.join("\n")}\n` };
  }

  async accessReviews() {
    const reviews = await prisma.accessReview.findMany({
      orderBy: { completedAt: "desc" },
      take: 50,
      select: { id: true, completedAt: true, outcomes: true, notes: true, snapshotHash: true, reviewedBy: { select: { fullName: true } } },
    });
    const last = reviews[0]?.completedAt ?? null;
    return {
      intervalDays: ACCESS_REVIEW_INTERVAL_DAYS,
      lastCompletedAt: last,
      nextDueAt: last ? new Date(last.getTime() + ACCESS_REVIEW_INTERVAL_DAYS * DAY_MS) : null,
      reviews: reviews.map((r) => ({ ...r, reviewedBy: r.reviewedBy.fullName })),
    };
  }

  /**
   * A Board member records that every role's permissions are still right,
   * or what needs changing (owner's decision, 2026-11-16). Every role must
   * be covered, and "changes needed" needs a note. It changes nothing by
   * itself: a needed change goes through role.permission_change. The
   * grants at that moment are kept with it, with their hash.
   */
  async completeAccessReview(input: CompleteAccessReviewInput, actorUserId: string) {
    const roles = await prisma.role.findMany({ orderBy: { key: "asc" }, include: { rolePermissions: { include: { permission: true } } } });
    const outcomes = this.parseOutcomes(input.outcomes, roles.map((r) => r.key));
    const snapshot = roles.map((role) => ({
      roleKey: role.key,
      grants: role.rolePermissions
        .filter((rp) => rp.canMaker || rp.canChecker)
        .map((rp) => ({ permissionKey: rp.permission.key, canMaker: rp.canMaker, canChecker: rp.canChecker }))
        .sort((a, b) => a.permissionKey.localeCompare(b.permissionKey)),
    }));
    const snapshotHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    return prisma.$transaction(async (tx) => {
      const review = await tx.accessReview.create({
        data: { reviewedByUserId: actorUserId, outcomes, notes: input.notes?.trim() || null, snapshot, snapshotHash },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "access_review.completed",
          entityType: "AccessReview",
          entityId: review.id,
          after: { outcomes, notes: review.notes, snapshotHash },
        },
      });
      return review;
    });
  }

  private parseOutcomes(raw: unknown[], roleKeys: string[]): ReviewOutcome[] {
    const outcomes = raw.map((entry) => {
      const { roleKey, outcome, note } = (entry ?? {}) as Record<string, unknown>;
      if (typeof roleKey !== "string" || !roleKeys.includes(roleKey)) throw new BadRequestException(`Unknown role "${String(roleKey)}".`);
      if (outcome !== "confirmed" && outcome !== "changes_needed") {
        throw new BadRequestException(`Mark ${roleKey.replace(/_/g, " ")} as confirmed or as needing changes.`);
      }
      const text = typeof note === "string" ? note.trim() : "";
      if (outcome === "changes_needed" && text.length < 5) {
        throw new BadRequestException(`Say what needs changing for ${roleKey.replace(/_/g, " ")}.`);
      }
      if (text.length > 1000) throw new BadRequestException("Keep each note under 1,000 characters.");
      return { roleKey, outcome, note: text || null } as ReviewOutcome;
    });
    const covered = new Set(outcomes.map((o) => o.roleKey));
    if (covered.size !== outcomes.length) throw new BadRequestException("Each role is reviewed once.");
    const missing = roleKeys.filter((k) => !covered.has(k));
    if (missing.length) throw new BadRequestException(`Review every role: ${missing.map((k) => k.replace(/_/g, " ")).join(", ")} still to do.`);
    return outcomes;
  }
}
