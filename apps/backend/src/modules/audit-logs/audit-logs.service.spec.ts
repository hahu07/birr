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

  describe("hash chain", () => {
    // Confirms the add_audit_log_hash_chain migration's BEFORE INSERT
    // trigger actually runs on every write() call, not just checking the
    // shape of what write() returns.
    test("write() links each new row to the previous one via previousHash/recordHash", async () => {
      const first = await service.write({
        actorType: "birr_staff",
        actorUserId,
        action: "test.chain_first",
        entityType: "TestEntity",
        entityId: "chain-fixture-1",
      });
      auditLogIds.push(first.id);

      const second = await service.write({
        actorType: "birr_staff",
        actorUserId,
        action: "test.chain_second",
        entityType: "TestEntity",
        entityId: "chain-fixture-2",
      });
      auditLogIds.push(second.id);

      expect(first.recordHash).toBeTruthy();
      expect(second.recordHash).toBeTruthy();
      expect(second.recordHash).not.toBe(first.recordHash);
      // The chain may have other writers between these two calls in a
      // shared dev DB, so don't assert second.previousHash === first
      // .recordHash directly — assert the weaker, still-meaningful
      // invariant that sequence strictly increases and both are chained
      // (non-null previousHash on the second write).
      expect(second.sequence > first.sequence).toBe(true);
      expect(second.previousHash).toBeTruthy();
    });

    // Pure round-trip check on verifyChain() itself — doesn't assert the
    // whole table is clean (this spec shares a dev DB with everything
    // else), just that verifyChain() runs and returns the expected shape.
    test("verifyChain() returns a well-formed result", async () => {
      const result = await service.verifyChain();
      expect(typeof result.ok).toBe("boolean");
      expect(result.totalRecords).toBeGreaterThan(0);
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.ok).toBe(result.issues.length === 0);
    });

    test("exportChain() returns records in ascending sequence order with a matching chain head", async () => {
      const log = await service.write({
        actorType: "birr_staff",
        actorUserId,
        action: "test.export_fixture",
        entityType: "TestEntity",
        entityId: "export-fixture-1",
      });
      auditLogIds.push(log.id);

      const result = await service.exportChain();
      expect(result.records.length).toBe(result.totalRecords);
      expect(result.chainHeadSequence).toBe(result.records[result.records.length - 1]!.sequence);
      expect(result.chainHeadHash).toBe(result.records[result.records.length - 1]!.recordHash);

      for (let i = 1; i < result.records.length; i++) {
        expect(result.records[i]!.sequence).toBeGreaterThan(result.records[i - 1]!.sequence);
      }

      const exported = result.records.find((r) => r.id === log.id);
      expect(exported?.recordHash).toBe(log.recordHash);
    });

    test("exportChain() filters by waqfId when provided", async () => {
      const result = await service.exportChain({ waqfId: "does-not-exist" });
      expect(result.records).toHaveLength(0);
      expect(result.totalRecords).toBe(0);
      expect(result.chainHeadSequence).toBeNull();
      expect(result.chainHeadHash).toBeNull();
    });
  });
});
