import { prisma } from "@birr/db";
import { PassThrough } from "stream";
import { AuditLogsService, ChainExportPlan } from "./audit-logs.service";

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
      data: { userId: actorUser.id, roles: { create: { role: "mutawalli_officer" } } },
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

    // Regression test for a real, reproduced concurrency bug (2026-10-03
    // codebase audit): the old trigger used
    // pg_advisory_xact_lock + a plain SELECT ... ORDER BY sequence DESC
    // LIMIT 1 to find the chain's current tip. Under READ COMMITTED, a
    // plain SELECT's snapshot stays fixed for its whole statement even
    // across time spent blocked on that lock — so a transaction that
    // blocks, then unblocks once the lock-holder commits, could still
    // read pre-commit data and chain off the SAME previousHash the
    // lock-holder already used: a genuine fork (two rows both claiming
    // the same predecessor), not a cosmetic ordering issue. Confirmed
    // live: 50 real fork points already existed in this project's dev
    // database from ordinary concurrent app traffic before the fix
    // (20261003010000_fix_audit_log_chain_head_race — SELECT ... FOR
    // UPDATE on a dedicated single-row chain-head table instead, which
    // doesn't have this stale-snapshot problem).
    //
    // Each write runs in its own transaction and does some other work
    // before the audit write, mirroring the real shape every write()
    // caller actually uses (e.g. VaultsService.create()'s
    // prisma.$transaction wrapping other work before tx.auditLog
    // .create()) — the bug specifically depends on time passing between
    // lock-wait and the read, which a bare, immediate write() call
    // wouldn't exercise.
    test("concurrent writes never fork the chain — no two rows claim the same previousHash", async () => {
      const ids = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(${0.01 * (i % 4)})`;
            const log = await tx.auditLog.create({
              data: {
                actorType: "birr_staff",
                actorUserId,
                action: "test.concurrent_chain_fork_regression",
                entityType: "TestEntity",
                entityId: `concurrent-fixture-${i}`,
              },
            });
            return log.id;
          }),
        ),
      );
      auditLogIds.push(...ids);

      const rows = await prisma.auditLog.findMany({
        where: { id: { in: ids } },
        select: { id: true, previousHash: true, recordHash: true },
      });
      expect(rows).toHaveLength(15);

      const previousHashes = rows.map((r) => r.previousHash);
      expect(new Set(previousHashes).size).toBe(previousHashes.length);

      const recordHashes = rows.map((r) => r.recordHash);
      expect(new Set(recordHashes).size).toBe(recordHashes.length);
    });

    // Pure round-trip check on verifyChain() itself — doesn't assert the
    // whole table is clean (this spec shares a dev DB with everything
    // else), just that verifyChain() runs and returns the expected shape.
    // Re-hashes the whole chain, so it takes as long as the log is big:
    // tens of thousands of rows in a dev database that tests write to.
    test("verifyChain() returns a well-formed result", async () => {
      const result = await service.verifyChain();
      expect(typeof result.ok).toBe("boolean");
      expect(result.totalRecords).toBeGreaterThan(0);
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.ok).toBe(result.issues.length === 0);
    }, 60_000);

    test("the database refuses to rewrite history: no deleting a person a record names, no changing or deleting a record", async () => {
      // Before 2026-11-15, deleting a Vault donor (or user, founder, AI
      // agent) silently nulled them out of every audit row naming them,
      // which broke those rows' hashes.
      const donor = await prisma.vaultDonor.create({ data: { email: `audit-immutable-${Date.now()}@example.com` } });
      const log = await prisma.auditLog.create({
        data: {
          actorType: "public_donor",
          actorDonorId: donor.id,
          action: "test.immutable_fixture",
          entityType: "TestEntity",
          entityId: "immutable-fixture-1",
        },
      });
      auditLogIds.push(log.id);

      await expect(prisma.vaultDonor.delete({ where: { id: donor.id } })).rejects.toThrow();
      await expect(prisma.$executeRaw`UPDATE "audit_logs" SET "action" = 'tampered' WHERE "id" = ${log.id}`).rejects.toThrow();
      await expect(prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${log.id}`).rejects.toThrow();
      const after = await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } });
      expect(after).toMatchObject({ action: "test.immutable_fixture", actorDonorId: donor.id });
    });

    // The export is streamed a page at a time (2026-11-17), never loaded
    // whole: these read it back the way an auditor's tool would, by
    // parsing the file the stream wrote.
    const exportFile = async (plan: ChainExportPlan, filters?: { waqfId?: string }, pageSize?: number) => {
      const out = new PassThrough();
      const chunks: Buffer[] = [];
      out.on("data", (c: Buffer) => chunks.push(c));
      await service.streamChainExport(out, plan, filters, pageSize);
      out.end();
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChainExportPlan & { records: { id: string; sequence: number; recordHash: string | null }[] };
    };
    const fundRows = async (waqfId: string, count: number) => {
      const rows = [];
      for (let i = 0; i < count; i++) {
        const log = await service.write({ actorType: "birr_staff", actorUserId, action: "test.export_fixture", entityType: "TestEntity", entityId: `export-${i}`, waqfId });
        auditLogIds.push(log.id);
        rows.push(log);
      }
      return rows;
    };

    test("a fund's export comes out in chain order, across several pages, with a matching chain head", async () => {
      const waqfId = `export-pages-${Date.now()}`;
      const rows = await fundRows(waqfId, 5);
      const plan = await service.planChainExport({ waqfId });
      expect(plan).toMatchObject({ totalRecords: 5, chainHeadSequence: rows[4]!.sequence, chainHeadHash: rows[4]!.recordHash });

      const file = await exportFile(plan, { waqfId }, 2); // pages of 2, 2 and 1
      expect(file).toMatchObject({ exportedAt: plan.exportedAt, totalRecords: 5, chainHeadSequence: plan.chainHeadSequence, chainHeadHash: plan.chainHeadHash });
      expect(file.records.map((r) => r.id)).toEqual(rows.map((r) => r.id));
      expect(file.records.map((r) => r.recordHash)).toEqual(rows.map((r) => r.recordHash));
    });

    test("rows written while an export runs are left out, so the file is one snapshot", async () => {
      const waqfId = `export-snapshot-${Date.now()}`;
      await fundRows(waqfId, 2);
      const plan = await service.planChainExport({ waqfId });
      await fundRows(waqfId, 1); // e.g. the "exported" row itself, written after the plan
      const file = await exportFile(plan, { waqfId });
      expect(file.records).toHaveLength(2);
      expect(file.totalRecords).toBe(2);
    });

    test("an export with nothing in it is still a valid, empty file", async () => {
      const plan = await service.planChainExport({ waqfId: "does-not-exist" });
      expect(plan).toMatchObject({ totalRecords: 0, chainHeadSequence: null, chainHeadHash: null });
      expect((await exportFile(plan, { waqfId: "does-not-exist" })).records).toEqual([]);
    });

    test("the whole chain streams out in order and matches its count", async () => {
      const plan = await service.planChainExport();
      const file = await exportFile(plan);
      expect(file.records).toHaveLength(plan.totalRecords);
      expect(file.records[file.records.length - 1]!.sequence).toBe(plan.chainHeadSequence);
      for (let i = 1; i < file.records.length; i++) {
        expect(file.records[i]!.sequence).toBeGreaterThan(file.records[i - 1]!.sequence);
      }
      // Tens of thousands of rows in a long-used dev database.
    }, 60_000);
  });
});
