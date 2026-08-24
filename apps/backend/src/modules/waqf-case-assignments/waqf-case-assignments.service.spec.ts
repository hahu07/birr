import { prisma } from "@birr/db";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { WaqfCaseAssignmentsService } from "./waqf-case-assignments.service";

describe("WaqfCaseAssignmentsService", () => {
  const service = new WaqfCaseAssignmentsService();

  const assignmentIds: string[] = [];
  const waqfIds: string[] = [];

  let actorUserId: string;
  let birrStaffId: string;
  let waqfId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff are not cleaned up in afterAll — same
    // reasoning as the other spec files (they end up referenced via
    // audit_logs.actorUserId, which is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `case-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const staffUser = await prisma.user.create({
      data: { email: `case-staff-${Date.now()}@example.com`, fullName: "Test Case Staff" },
    });
    const staff = await prisma.birrStaff.create({
      data: { userId: staffUser.id, staffRole: "compliance_officer" },
    });
    birrStaffId = staff.id;

    // Every Waqf must belong to a Foundation now — this fixture doesn't
    // exercise founder scoping, so no FoundationFounder rows are needed.
    const foundation = await prisma.foundation.create({
      data: { name: "Case Assignment Fixture Foundation" },
    });
    const waqf = await prisma.waqf.create({
      data: {
        name: "Case Assignment Fixture Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundation.id,
      },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);
  });

  afterAll(async () => {
    await prisma.waqfCaseAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  function auditLogsFor(entityId: string) {
    return prisma.auditLog.findMany({ where: { entityId } });
  }

  test("assign() writes the row and a matching audit log", async () => {
    const assignment = await service.assign({
      waqfId,
      birrStaffId,
      assignmentRole: "compliance_reviewer",
      actorUserId,
    });
    assignmentIds.push(assignment.id);

    expect(assignment.status).toBe("active");

    const logs = await auditLogsFor(assignment.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "WaqfCaseAssignment",
      action: "waqf_case_assignment.assigned",
      actorUserId,
    });
  });

  test("assign() rejects a duplicate (waqfId, birrStaffId, assignmentRole) with a clean conflict, not a raw DB error", async () => {
    await expect(
      service.assign({
        waqfId,
        birrStaffId,
        assignmentRole: "compliance_reviewer",
        actorUserId,
      }),
    ).rejects.toThrow(ConflictException);
  });

  test("close() happy path: status transitions, closedAt is set, audit log written", async () => {
    const assignment = await service.assign({
      waqfId,
      birrStaffId,
      assignmentRole: "auditor",
      actorUserId,
    });
    assignmentIds.push(assignment.id);

    const closed = await service.close({
      id: assignment.id,
      status: "closed",
      actorUserId,
    });

    expect(closed.status).toBe("closed");
    expect(closed.closedAt).not.toBeNull();

    const logs = await auditLogsFor(assignment.id);
    expect(logs.some((l) => l.action === "waqf_case_assignment.closed")).toBe(true);
  });

  test("close() rejects closing an already-closed assignment", async () => {
    const assignment = await service.assign({
      waqfId,
      birrStaffId,
      assignmentRole: "investment_officer",
      actorUserId,
    });
    assignmentIds.push(assignment.id);

    await service.close({ id: assignment.id, status: "closed", actorUserId });

    await expect(
      service.close({ id: assignment.id, status: "closed", actorUserId }),
    ).rejects.toThrow(BadRequestException);
  });
});
