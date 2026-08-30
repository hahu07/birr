import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, CoiStatus, BirrStaffRole } from "@birr/db";
import { NotificationsService } from "../notifications/notifications.service";

export interface DeclareInput {
  birrStaffId: string;
  waqfId?: string;
  declarationText: string;
}

export type CoiReviewOutcome = Exclude<CoiStatus, "declared">;

export interface ReviewInput {
  id: string;
  reviewerUserId: string;
  status: CoiReviewOutcome;
}

// Resolved for display only — never select passwordHash, same principle
// as BirrStaffService's SAFE_USER_SELECT / AuditLogsController's include.
const COI_INCLUDE = {
  birrStaff: { select: { id: true, staffRole: true, user: { select: { id: true, fullName: true } } } },
  waqf: { select: { id: true, name: true } },
  reviewedByUser: { select: { id: true, fullName: true } },
} as const;

// No RolePermission row exists for "who may review a conflict of
// interest" — declare()/review() are ungated for any active BirrStaff
// (see the controller's own comment: "any active BirrStaff may declare
// or review"), so there's no eligible-role table to query the way
// GovernedActionsService.notifyProposed() does. compliance_officer and
// audit_committee are the closest semantic fit for day-to-day review;
// escalation additionally reaches audit_committee + platform_admin.
// Judgment calls, not something enforced by a guard today — revisit if
// the product owner wants a real permission for this workflow.
const COI_REVIEW_ROLES: BirrStaffRole[] = ["compliance_officer", "audit_committee"];
const COI_ESCALATION_ROLES: BirrStaffRole[] = ["audit_committee", "platform_admin"];

@Injectable()
export class ConflictOfInterestDeclarationsService {
  constructor(private readonly notificationsService: NotificationsService) {}

  async declare(input: DeclareInput) {
    const staff = await prisma.birrStaff.findUnique({
      where: { id: input.birrStaffId },
    });
    if (!staff) {
      throw new NotFoundException(`BirrStaff "${input.birrStaffId}" not found.`);
    }

    const declaration = await prisma.$transaction(async (tx) => {
      const declaration = await tx.conflictOfInterestDeclaration.create({
        data: {
          birrStaffId: staff.id,
          declaredByUserId: staff.userId,
          waqfId: input.waqfId,
          declarationText: input.declarationText,
        },
      });

      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId: staff.userId,
          action: "coi.declared",
          entityType: "ConflictOfInterestDeclaration",
          entityId: declaration.id,
          after: declaration as any,
        },
      });

      return declaration;
    });

    // Deliberately not awaited — same fire-and-forget posture as every
    // other post-transaction notify() call this session.
    this.notifyReviewers(COI_REVIEW_ROLES, staff.userId, "coi.needs_review", declaration.id).catch((err) => {
      console.error(`Failed to notify reviewers of new COI declaration "${declaration.id}":`, err);
    });

    return declaration;
  }

  private async notifyReviewers(
    roles: BirrStaffRole[],
    excludeUserId: string,
    type: string,
    declarationId: string,
  ): Promise<void> {
    const reviewers = await prisma.birrStaff.findMany({
      where: { staffRole: { in: roles }, status: "active", userId: { not: excludeUserId } },
      select: { userId: true },
    });
    await Promise.all(
      reviewers.map((reviewer) =>
        this.notificationsService.notify({
          recipientType: "birr_staff",
          recipientUserId: reviewer.userId,
          type,
          title: type === "coi.escalated" ? "Conflict of interest escalated" : "Conflict of interest needs review",
          body:
            type === "coi.escalated"
              ? "A declared conflict of interest was escalated and needs senior review."
              : "A new conflict of interest declaration needs review.",
          linkUrl: "/ops/conflict-of-interest",
          relatedEntityType: "ConflictOfInterestDeclaration",
          relatedEntityId: declarationId,
        }),
      ),
    );
  }

  async review(input: ReviewInput) {
    const declaration = await prisma.conflictOfInterestDeclaration.findUnique({
      where: { id: input.id },
    });
    if (!declaration) {
      throw new NotFoundException(`Declaration "${input.id}" not found.`);
    }
    if (declaration.status !== "declared") {
      throw new BadRequestException(
        `Declaration "${declaration.id}" has already been reviewed (status: ${declaration.status}).`,
      );
    }

    // This check duplicates the DB constraint deliberately — fail with a
    // clear application error before ever hitting the DB, but never treat
    // this app-layer check as the actual guarantee. The
    // coi_reviewer_not_declarant constraint (see the migration named for
    // it) is the real enforcement.
    if (declaration.declaredByUserId === input.reviewerUserId) {
      throw new ForbiddenException(
        "The declarant of this conflict cannot also be its reviewer.",
      );
    }

    const reviewed = await prisma.$transaction(async (tx) => {
      const reviewed = await tx.conflictOfInterestDeclaration.update({
        where: { id: declaration.id },
        data: {
          status: input.status,
          reviewedByUserId: input.reviewerUserId,
          reviewedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          waqfId: declaration.waqfId,
          actorType: "birr_staff",
          actorUserId: input.reviewerUserId,
          action: `coi.${input.status}`,
          entityType: "ConflictOfInterestDeclaration",
          entityId: declaration.id,
          before: declaration as any,
          after: reviewed as any,
        },
      });

      return reviewed;
    });

    // Feedback to the declarant — in-app only, same posture as
    // governed_action.decided.own. Deliberately not awaited.
    this.notificationsService
      .notify({
        recipientType: "birr_staff",
        recipientUserId: declaration.declaredByUserId,
        type: "coi.reviewed",
        title: `Your conflict of interest declaration was ${input.status}`,
        body: `Your conflict of interest declaration was reviewed: ${input.status}.`,
        linkUrl: "/ops/conflict-of-interest",
        relatedEntityType: "ConflictOfInterestDeclaration",
        relatedEntityId: declaration.id,
      })
      .catch((err) => {
        console.error(`Failed to notify declarant of reviewed COI "${declaration.id}":`, err);
      });

    if (input.status === "escalated") {
      this.notifyReviewers(COI_ESCALATION_ROLES, input.reviewerUserId, "coi.escalated", declaration.id).catch((err) => {
        console.error(`Failed to notify escalation reviewers for COI "${declaration.id}":`, err);
      });
    }

    return reviewed;
  }

  findById(id: string) {
    return prisma.conflictOfInterestDeclaration.findUnique({
      where: { id },
      include: COI_INCLUDE,
    });
  }

  list() {
    return prisma.conflictOfInterestDeclaration.findMany({
      orderBy: { declaredAt: "desc" },
      include: COI_INCLUDE,
    });
  }
}
