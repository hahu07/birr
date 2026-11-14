import { prisma } from "@birr/db";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConflictOfInterestDeclarationsService } from "./conflict-of-interest-declarations.service";
import type { NotificationsService } from "../notifications/notifications.service";

describe("ConflictOfInterestDeclarationsService", () => {
  // Records notifications instead of writing them. declare() notifies every
  // active compliance officer and Audit Committee member, and the shared dev
  // database holds about a thousand left behind by earlier runs. Writing a
  // notification for each one filled the connection pool, so the next test's
  // transaction couldn't start in time. The fan-out isn't what these tests
  // check, so it doesn't touch the database here.
  const notify = jest.fn().mockResolvedValue(undefined);
  const service = new ConflictOfInterestDeclarationsService({ notify } as unknown as NotificationsService);

  const declarationIds: string[] = [];

  let declarantStaffId: string;
  let declarantUserId: string;
  let reviewerStaffId: string;
  let reviewerUserId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff are not cleaned up in afterAll — same
    // reasoning as governed-actions.service.spec.ts (they end up
    // referenced via audit_logs.actorUserId, and that table is
    // insert-only at the DB role level, so deleting them would require
    // an implicit UPDATE on audit_logs that the app role can't perform).
    const declarantUser = await prisma.user.create({
      data: { email: `coi-declarant-${Date.now()}@example.com`, fullName: "Test Declarant" },
    });
    declarantUserId = declarantUser.id;
    const declarantStaff = await prisma.birrStaff.create({
      data: { userId: declarantUser.id, roles: { create: { role: "compliance_officer" } } },
    });
    declarantStaffId = declarantStaff.id;

    const reviewerUser = await prisma.user.create({
      data: { email: `coi-reviewer-${Date.now()}@example.com`, fullName: "Test Reviewer" },
    });
    reviewerUserId = reviewerUser.id;
    const reviewerStaff = await prisma.birrStaff.create({
      data: { userId: reviewerUser.id, roles: { create: { role: "audit_committee" } } },
    });
    reviewerStaffId = reviewerStaff.id;
  });

  afterAll(async () => {
    await prisma.conflictOfInterestDeclaration.deleteMany({
      where: { id: { in: declarationIds } },
    });
    // They can't be deleted (see beforeAll), but suspending them keeps them
    // out of every later run's reviewer lists.
    await prisma.birrStaff.updateMany({
      where: { id: { in: [declarantStaffId, reviewerStaffId] } },
      data: { status: "suspended" },
    });
    await prisma.$disconnect();
  });

  function auditLogsFor(entityId: string) {
    return prisma.auditLog.findMany({ where: { entityId } });
  }

  test("declare() writes the row with the correct declaredByUserId and an audit log", async () => {
    const declaration = await service.declare({
      birrStaffId: declarantStaffId,
      declarationText: "I have a family relationship with a beneficiary applicant.",
    });
    declarationIds.push(declaration.id);

    expect(declaration.status).toBe("declared");
    expect(declaration.declaredByUserId).toBe(declarantUserId);

    const logs = await auditLogsFor(declaration.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "ConflictOfInterestDeclaration",
      action: "coi.declared",
      actorUserId: declarantUserId,
    });
  });

  test("review() rejects the declarant reviewing their own declaration (app layer)", async () => {
    const declaration = await service.declare({
      birrStaffId: declarantStaffId,
      declarationText: "Self-review attempt fixture.",
    });
    declarationIds.push(declaration.id);

    await expect(
      service.review({
        id: declaration.id,
        reviewerUserId: declarantUserId,
        status: "cleared",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  test("the database itself rejects reviewedByUserId = declaredByUserId, bypassing the service", async () => {
    const declaration = await service.declare({
      birrStaffId: declarantStaffId,
      declarationText: "DB constraint fixture.",
    });
    declarationIds.push(declaration.id);

    // Bypasses ConflictOfInterestDeclarationsService.review()'s app-layer
    // check entirely — this is what actually proves the
    // coi_reviewer_not_declarant DB constraint holds, not just the
    // application code.
    await expect(
      prisma.conflictOfInterestDeclaration.update({
        where: { id: declaration.id },
        data: { reviewedByUserId: declarantUserId },
      }),
    ).rejects.toThrow(/coi_reviewer_not_declarant/);
  });

  test("review() by a different staff member updates status and writes an audit log", async () => {
    const declaration = await service.declare({
      birrStaffId: declarantStaffId,
      declarationText: "Happy path fixture.",
    });
    declarationIds.push(declaration.id);

    const reviewed = await service.review({
      id: declaration.id,
      reviewerUserId,
      status: "cleared",
    });

    expect(reviewed.status).toBe("cleared");
    expect(reviewed.reviewedByUserId).toBe(reviewerUserId);
    expect(reviewed.reviewedAt).not.toBeNull();

    const logs = await auditLogsFor(declaration.id);
    expect(logs.some((l) => l.action === "coi.cleared" && l.actorUserId === reviewerUserId)).toBe(
      true,
    );
  });

  test("review() rejects reviewing an already-decided declaration", async () => {
    const declaration = await service.declare({
      birrStaffId: declarantStaffId,
      declarationText: "Already-decided fixture.",
    });
    declarationIds.push(declaration.id);

    await service.review({ id: declaration.id, reviewerUserId, status: "cleared" });

    await expect(
      service.review({ id: declaration.id, reviewerUserId, status: "escalated" }),
    ).rejects.toThrow(BadRequestException);
  });
});
