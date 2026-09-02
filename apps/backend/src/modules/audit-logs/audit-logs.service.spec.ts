import { prisma } from "@birr/db";
import { AuditLogsService } from "./audit-logs.service";

describe("AuditLogsService", () => {
  const service = new AuditLogsService();

  const auditLogIds: string[] = [];
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `audit-logs-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });
  });

  afterAll(async () => {
    // audit_logs is insert-only at the DB role level (UPDATE/DELETE
    // revoked from birr_app) — the fixture rows this spec writes are
    // deliberately left in place, same as every other spec that writes
    // audit_logs rows via a service call rather than a raw insert.
    await prisma.$disconnect();
  });

  test("write() persists every field, including before/after snapshots", async () => {
    const log = await service.write({
      actorType: "birr_staff",
      actorUserId,
      action: "test.entity_written",
      entityType: "TestEntity",
      entityId: "fixture-entity-id",
      before: { status: "old" },
      after: { status: "new" },
      ipAddress: "203.0.113.5",
    });
    auditLogIds.push(log.id);

    expect(log).toMatchObject({
      actorType: "birr_staff",
      actorUserId,
      action: "test.entity_written",
      entityType: "TestEntity",
      entityId: "fixture-entity-id",
      before: { status: "old" },
      after: { status: "new" },
      ipAddress: "203.0.113.5",
    });

    const persisted = await prisma.auditLog.findUnique({ where: { id: log.id } });
    expect(persisted).toMatchObject({ before: { status: "old" }, after: { status: "new" } });
  });

  test("write() accepts an ai_agent actor via actorAgentId instead of actorUserId", async () => {
    const agent = await prisma.aiAgent.create({
      data: { name: `audit-logs-fixture-agent-${Date.now()}`, taskType: "compliance_monitoring", apiKeyHash: "fixture-hash" },
    });

    const log = await service.write({
      actorType: "ai_agent",
      actorAgentId: agent.id,
      action: "test.agent_drafted",
      entityType: "TestEntity",
      entityId: "fixture-entity-id-2",
      after: { drafted: true },
    });
    auditLogIds.push(log.id);

    expect(log.actorType).toBe("ai_agent");
    expect(log.actorAgentId).toBe(agent.id);
    expect(log.actorUserId).toBeNull();
  });

  test("write() defaults before/after/waqfId/ipAddress to null when omitted", async () => {
    const log = await service.write({
      actorType: "birr_staff",
      actorUserId,
      action: "test.minimal_write",
      entityType: "TestEntity",
      entityId: "fixture-entity-id-3",
    });
    auditLogIds.push(log.id);

    expect(log.waqfId).toBeNull();
    expect(log.before).toBeNull();
    expect(log.after).toBeNull();
    expect(log.ipAddress).toBeNull();
  });
});
