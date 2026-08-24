import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, CoiStatus } from "@birr/db";

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

@Injectable()
export class ConflictOfInterestDeclarationsService {
  async declare(input: DeclareInput) {
    const staff = await prisma.birrStaff.findUnique({
      where: { id: input.birrStaffId },
    });
    if (!staff) {
      throw new NotFoundException(`BirrStaff "${input.birrStaffId}" not found.`);
    }

    return prisma.$transaction(async (tx) => {
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

    return prisma.$transaction(async (tx) => {
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
