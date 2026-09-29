import { prisma } from "@birr/db";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { FounderRequestsService } from "./founder-requests.service";

describe("FounderRequestsService", () => {
  const service = new FounderRequestsService();

  const founderRequestIds: string[] = [];
  const waqfCaseAssignmentIds: string[] = [];

  let founderAId: string;
  let founderBId: string;
  let waqfAId: string;
  let waqfBId: string;
  let staffUserId: string;
  let staffId: string;
  let platformAdminId: string;

  beforeAll(async () => {
    const founderA = await prisma.founder.create({ data: { name: "Founder Requests Fixture Founder A", kind: "institution" } });
    founderAId = founderA.id;
    const founderB = await prisma.founder.create({ data: { name: "Founder Requests Fixture Founder B", kind: "institution" } });
    founderBId = founderB.id;

    const foundationA = await prisma.foundation.create({ data: { name: "Founder Requests Fixture Foundation A" } });
    await prisma.foundationFounder.create({ data: { foundationId: foundationA.id, founderId: founderAId } });

    const waqfA = await prisma.waqf.create({
      data: { name: "Founder Requests Fixture Waqf A", type: "project", jurisdiction: "NG", foundationId: foundationA.id },
    });
    waqfAId = waqfA.id;

    const foundationB = await prisma.foundation.create({ data: { name: "Founder Requests Fixture Foundation B" } });
    const waqfB = await prisma.waqf.create({
      data: { name: "Founder Requests Fixture Waqf B", type: "project", jurisdiction: "NG", foundationId: foundationB.id },
    });
    waqfBId = waqfB.id;

    const staffUser = await prisma.user.create({
      data: { email: `founder-requests-staff-${Date.now()}@example.com`, fullName: "Fixture Staff" },
    });
    staffUserId = staffUser.id;
    const staff = await prisma.birrStaff.create({ data: { userId: staffUser.id, staffRole: "mutawalli_officer" } });
    staffId = staff.id;

    const adminUser = await prisma.user.create({
      data: { email: `founder-requests-admin-${Date.now()}@example.com`, fullName: "Fixture Platform Admin" },
    });
    const admin = await prisma.birrStaff.create({ data: { userId: adminUser.id, staffRole: "platform_admin" } });
    platformAdminId = admin.id;
  });

  afterAll(async () => {
    await prisma.founderRequest.deleteMany({ where: { id: { in: founderRequestIds } } });
    await prisma.waqfCaseAssignment.deleteMany({ where: { id: { in: waqfCaseAssignmentIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: [waqfAId, waqfBId] } } });
  });

  describe("create()", () => {
    test("rejects a distribution_approval request missing a required detail key", async () => {
      await expect(
        service.create({ waqfId: waqfAId, type: "distribution_approval", details: { causeId: "x" } }, founderAId),
      ).rejects.toThrow(BadRequestException);
    });

    test("creates a request, audit-logged, when required details are present", async () => {
      const request = await service.create(
        {
          waqfId: waqfAId,
          type: "distribution_approval",
          details: { causeId: "cause-1", amount: "500", description: "For the family flagged as most urgent this month." },
          note: "This family's water needs are urgent.",
        },
        founderAId,
      );
      founderRequestIds.push(request.id);

      expect(request.status).toBe("pending");
      expect(request.waqfId).toBe(waqfAId);

      const logs = await prisma.auditLog.findMany({ where: { entityId: request.id, action: "founder_request.created" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "founder_user", actorFounderId: founderAId, waqfId: waqfAId });
    });

    test("rejects a request against a waqf the founder doesn't own", async () => {
      await expect(
        service.create({ waqfId: waqfBId, type: "other", details: {} }, founderAId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("founder-scoped reads", () => {
    let requestId: string;

    beforeAll(async () => {
      const request = await service.create({ waqfId: waqfAId, type: "other", details: { note: "General question" } }, founderAId);
      founderRequestIds.push(request.id);
      requestId = request.id;
    });

    test("listForFounder() only returns the calling founder's own requests", async () => {
      const asOwner = await service.listForFounder(founderAId);
      expect(asOwner.some((r) => r.id === requestId)).toBe(true);

      const asStranger = await service.listForFounder(founderBId);
      expect(asStranger.some((r) => r.id === requestId)).toBe(false);
    });

    test("findByIdForFounder() returns null for a request belonging to a different founder", async () => {
      expect(await service.findByIdForFounder(requestId, founderBId)).toBeNull();
      expect(await service.findByIdForFounder(requestId, founderAId)).not.toBeNull();
    });
  });

  describe("staff caseload scoping", () => {
    test("assertStaffCanAccessWaqf() rejects staff with no active case assignment on the waqf", async () => {
      await expect(service.assertStaffCanAccessWaqf(waqfAId, { id: staffId, staffRole: "mutawalli_officer" })).rejects.toThrow(
        ForbiddenException,
      );
    });

    test("assertStaffCanAccessWaqf() allows platform_admin unconditionally", async () => {
      await expect(
        service.assertStaffCanAccessWaqf(waqfAId, { id: platformAdminId, staffRole: "platform_admin" }),
      ).resolves.toBeUndefined();
    });

    test("list() without a case assignment only returns requests on the staff member's own caseload", async () => {
      const assignment = await prisma.waqfCaseAssignment.create({
        data: { waqfId: waqfAId, birrStaffId: staffId, assignmentRole: "mutawalli_officer", status: "active" },
      });
      waqfCaseAssignmentIds.push(assignment.id);

      const scoped = await service.list(undefined, { id: staffId, staffRole: "mutawalli_officer" });
      expect(scoped.every((r) => r.waqfId === waqfAId)).toBe(true);

      const unscoped = await service.list(undefined, { id: platformAdminId, staffRole: "platform_admin" });
      expect(unscoped.length).toBeGreaterThanOrEqual(scoped.length);
    });
  });

  describe("decide()", () => {
    test("transitions status and audit-logs the decision, actorUserId set to the staff member's User id", async () => {
      const request = await service.create({ waqfId: waqfAId, type: "other", details: {} }, founderAId);
      founderRequestIds.push(request.id);

      const reviewed = await service.decide(request.id, { status: "in_review" }, { id: staffId, userId: staffUserId });
      expect(reviewed.status).toBe("in_review");

      const actioned = await service.decide(
        request.id,
        { status: "actioned", reviewNote: "Created distribution.approve for this." },
        { id: staffId, userId: staffUserId },
      );
      expect(actioned.status).toBe("actioned");
      expect(actioned.reviewedAt).not.toBeNull();

      const logs = await prisma.auditLog.findMany({
        where: { entityId: request.id, action: { startsWith: "founder_request." } },
        orderBy: { createdAt: "asc" },
      });
      expect(logs.map((l) => l.action)).toEqual(["founder_request.created", "founder_request.in_review", "founder_request.actioned"]);
      expect(logs[2]).toMatchObject({ actorType: "birr_staff", actorUserId: staffUserId });
    });

    test("a request already actioned or declined can't be decided again", async () => {
      const request = await service.create({ waqfId: waqfAId, type: "other", details: {} }, founderAId);
      founderRequestIds.push(request.id);
      await service.decide(request.id, { status: "declined", reviewNote: "Not this cycle." }, { id: staffId, userId: staffUserId });

      await expect(
        service.decide(request.id, { status: "actioned" }, { id: staffId, userId: staffUserId }),
      ).rejects.toThrow(BadRequestException);
    });

    test("throws NotFoundException for an unknown request id", async () => {
      await expect(
        service.decide("00000000-0000-0000-0000-000000000000", { status: "in_review" }, { id: staffId, userId: staffUserId }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
