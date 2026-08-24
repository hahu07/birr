import { prisma } from "@birr/db";
import { CompliancePolicySetsService } from "./compliance-policy-sets.service";

describe("CompliancePolicySetsService", () => {
  const service = new CompliancePolicySetsService();

  let actorUserId: string;
  let jurisdiction: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `compliance-policy-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "platform_admin" },
    });
  });

  beforeEach(() => {
    jurisdiction = `TEST-${Date.now()}`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("upsert() on a new jurisdiction writes a .created audit log", async () => {
    const policySet = await service.upsert(jurisdiction, { frameworkName: "AAOIFI" }, actorUserId);

    const logs = await prisma.auditLog.findMany({ where: { entityId: policySet.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "CompliancePolicySet",
      action: "compliance_policy_set.created",
      actorType: "birr_staff",
      actorUserId,
    });

    await service.remove(jurisdiction, actorUserId);
  });

  test("upsert() on an existing jurisdiction writes an .updated audit log with before/after", async () => {
    const created = await service.upsert(jurisdiction, { frameworkName: "AAOIFI" }, actorUserId);
    const updated = await service.upsert(jurisdiction, { frameworkName: "IFSB" }, actorUserId);
    expect(updated.id).toBe(created.id);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: "compliance_policy_set.updated" },
    });
    expect(logs).toHaveLength(1);
    expect((logs[0].before as any).frameworkName).toBe("AAOIFI");
    expect((logs[0].after as any).frameworkName).toBe("IFSB");

    await service.remove(jurisdiction, actorUserId);
  });

  test("remove() writes a .deleted audit log and is a graceful no-op for an unknown jurisdiction", async () => {
    const policySet = await service.upsert(jurisdiction, { frameworkName: "AAOIFI" }, actorUserId);
    await service.remove(jurisdiction, actorUserId);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: policySet.id, action: "compliance_policy_set.deleted" },
    });
    expect(logs).toHaveLength(1);

    await expect(service.remove(jurisdiction, actorUserId)).resolves.toBeUndefined();
  });
});
