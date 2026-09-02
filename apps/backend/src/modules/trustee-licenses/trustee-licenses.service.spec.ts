import { prisma } from "@birr/db";
import { NotFoundException } from "@nestjs/common";
import { TrusteeLicensesService } from "./trustee-licenses.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";

describe("TrusteeLicensesService", () => {
  const service = new TrusteeLicensesService(createFakeNotificationsService());

  const licenseIds: string[] = [];
  const policySetJurisdictions: string[] = [];
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `trustee-license-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "platform_admin" },
    });
  });

  afterAll(async () => {
    await prisma.trusteeLicense.deleteMany({ where: { id: { in: licenseIds } } });
    await prisma.compliancePolicySet.deleteMany({ where: { jurisdiction: { in: policySetJurisdictions } } });
    await prisma.$disconnect();
  });

  test("create() writes the license and a matching audit_logs record", async () => {
    const license = await service.create(
      {
        jurisdiction: `TEST-${Date.now()}`,
        status: "active",
        licensingAuthority: "Test Authority",
      },
      actorUserId,
    );
    licenseIds.push(license.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: license.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "TrusteeLicense",
      action: "trustee_license.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });

  test("update() writes an audit_logs record with before/after snapshots", async () => {
    const license = await service.create(
      {
        jurisdiction: `TEST-${Date.now()}`,
        status: "pending",
        licensingAuthority: "Test Authority",
      },
      actorUserId,
    );
    licenseIds.push(license.id);

    const updated = await service.update(license.id, { status: "active" }, actorUserId);
    expect(updated.status).toBe("active");

    const logs = await prisma.auditLog.findMany({
      where: { entityId: license.id, action: "trustee_license.updated" },
    });
    expect(logs).toHaveLength(1);
    expect((logs[0].before as any).status).toBe("pending");
    expect((logs[0].after as any).status).toBe("active");
  });

  test("update() on an unknown id rejects and writes no audit log", async () => {
    await expect(service.update("00000000-0000-0000-0000-000000000000", { status: "active" }, actorUserId)).rejects.toThrow(
      NotFoundException,
    );
    const logs = await prisma.auditLog.findMany({
      where: { entityId: "00000000-0000-0000-0000-000000000000", entityType: "TrusteeLicense" },
    });
    expect(logs).toHaveLength(0);
  });

  describe("statusForJurisdiction", () => {
    test("returns 'unlicensed' when no license row and no compliance policy set exist", async () => {
      const jurisdiction = `TEST-NONE-${Date.now()}`;
      await expect(service.statusForJurisdiction(jurisdiction)).resolves.toBe("unlicensed");
    });

    test("returns 'not_required' when the jurisdiction's policy set says so, even with no license row", async () => {
      const jurisdiction = `TEST-EXEMPT-${Date.now()}`;
      policySetJurisdictions.push(jurisdiction);
      await prisma.compliancePolicySet.create({
        data: { jurisdiction, frameworkName: "Test framework", requiresTrusteeLicense: false },
      });

      await expect(service.statusForJurisdiction(jurisdiction)).resolves.toBe("not_required");
    });

    test("returns 'unlicensed', not 'not_required', when the policy set explicitly requires one and none exists", async () => {
      const jurisdiction = `TEST-REQUIRED-${Date.now()}`;
      policySetJurisdictions.push(jurisdiction);
      await prisma.compliancePolicySet.create({
        data: { jurisdiction, frameworkName: "Test framework", requiresTrusteeLicense: true },
      });

      await expect(service.statusForJurisdiction(jurisdiction)).resolves.toBe("unlicensed");
    });

    test("a stray active license row is ignored once the jurisdiction is marked not requiring one", async () => {
      const jurisdiction = `TEST-STRAY-${Date.now()}`;
      policySetJurisdictions.push(jurisdiction);
      const license = await service.create(
        { jurisdiction, status: "active", licensingAuthority: "Test Authority" },
        actorUserId,
      );
      licenseIds.push(license.id);
      await prisma.compliancePolicySet.create({
        data: { jurisdiction, frameworkName: "Test framework", requiresTrusteeLicense: false },
      });

      await expect(service.statusForJurisdiction(jurisdiction)).resolves.toBe("not_required");
    });
  });
});
