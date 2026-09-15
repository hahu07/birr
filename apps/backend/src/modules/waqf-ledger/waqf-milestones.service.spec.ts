import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { WaqfMilestonesService } from "./waqf-milestones.service";

describe("WaqfMilestonesService", () => {
  const service = new WaqfMilestonesService();

  const waqfIds: string[] = [];
  const ledgerAccountIds: string[] = [];
  let actorUserId: string;
  let foundationId: string;
  let projectWaqfId: string;
  let investmentWaqfId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `waqf-milestones-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const foundation = await prisma.foundation.create({ data: { name: "Waqf Milestones Fixture Foundation" } });
    foundationId = foundation.id;

    const projectWaqf = await prisma.waqf.create({
      data: { name: "Milestones Test Waqf", type: "project", jurisdiction: "NG", foundationId },
    });
    projectWaqfId = projectWaqf.id;
    waqfIds.push(projectWaqf.id);

    const investmentWaqf = await prisma.waqf.create({
      data: { name: "Milestones Investment Waqf", type: "investment", jurisdiction: "NG", foundationId },
    });
    investmentWaqfId = investmentWaqf.id;
    waqfIds.push(investmentWaqf.id);
  });

  afterAll(async () => {
    await prisma.waqfExpense.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqfLedgerAccount.deleteMany({ where: { id: { in: ledgerAccountIds } } });
    await prisma.waqfMilestone.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.foundation.delete({ where: { id: foundationId } });
    await prisma.$disconnect();
  });

  test("create() writes the milestone and an audit_logs record", async () => {
    const milestone = await service.create(
      { waqfId: projectWaqfId, name: "Site survey & permits", sequence: 1, targetAmount: "1000" },
      actorUserId,
    );
    expect(milestone.status).toBe("pending");

    const logs = await prisma.auditLog.findMany({ where: { entityId: milestone.id, action: "waqf_milestone.created" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, waqfId: projectWaqfId });
  });

  test("create() rejects a milestone against an investment-type waqf", async () => {
    await expect(
      service.create({ waqfId: investmentWaqfId, name: "Not applicable", sequence: 1 }, actorUserId),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() rejects a duplicate sequence on the same waqf", async () => {
    await service.create({ waqfId: projectWaqfId, name: "Foundation laid", sequence: 2 }, actorUserId);
    await expect(
      service.create({ waqfId: projectWaqfId, name: "Duplicate sequence", sequence: 2 }, actorUserId),
    ).rejects.toThrow(ConflictException);
  });

  test("create() throws NotFoundException for an unknown waqfId", async () => {
    await expect(
      service.create({ waqfId: "00000000-0000-0000-0000-000000000000", name: "Ghost milestone", sequence: 1 }, actorUserId),
    ).rejects.toThrow(NotFoundException);
  });

  test("list() returns a waqf's milestones ordered by sequence", async () => {
    const milestones = await service.list(projectWaqfId);
    expect(milestones.map((m) => m.sequence)).toEqual([1, 2]);
  });

  test("list() reports actualSpend as the sum of a milestone's own expenses, per currency, never mixed with another milestone's", async () => {
    const account = await prisma.waqfLedgerAccount.create({
      data: { code: `WAQF-EXP-MS-TEST-${Date.now()}`, name: "Materials (Milestone Test)", type: "expense" },
    });
    ledgerAccountIds.push(account.id);

    const [milestoneA, milestoneB] = await service.list(projectWaqfId);
    await prisma.waqfExpense.createMany({
      data: [
        { waqfId: projectWaqfId, waqfMilestoneId: milestoneA.id, ledgerAccountId: account.id, amount: "300", currency: "USD", description: "A — part 1", recordedByUserId: actorUserId },
        { waqfId: projectWaqfId, waqfMilestoneId: milestoneA.id, ledgerAccountId: account.id, amount: "200", currency: "USD", description: "A — part 2", recordedByUserId: actorUserId },
        { waqfId: projectWaqfId, waqfMilestoneId: milestoneB.id, ledgerAccountId: account.id, amount: "900", currency: "USD", description: "B", recordedByUserId: actorUserId },
      ],
    });

    const milestones = await service.list(projectWaqfId);
    expect(milestones.find((m) => m.id === milestoneA.id)?.actualSpend).toEqual([{ currency: "USD", amount: "500" }]);
    expect(milestones.find((m) => m.id === milestoneB.id)?.actualSpend).toEqual([{ currency: "USD", amount: "900" }]);
  });

  test("list() reports actualSpend as an empty array for a milestone with no expenses yet", async () => {
    const milestone = await service.create({ waqfId: projectWaqfId, name: "No spend yet", sequence: 8 }, actorUserId);
    const milestones = await service.list(projectWaqfId);
    expect(milestones.find((m) => m.id === milestone.id)?.actualSpend).toEqual([]);
  });

  describe("complete()", () => {
    test("sets status to completed and completedAt", async () => {
      const milestone = await service.create({ waqfId: projectWaqfId, name: "Well drilled", sequence: 3 }, actorUserId);
      const completed = await prisma.$transaction((tx) => service.complete(milestone.id, tx));
      expect(completed.status).toBe("completed");
      expect(completed.completedAt).not.toBeNull();
    });

    test("rejects a milestone that's already completed", async () => {
      const milestone = await service.create({ waqfId: projectWaqfId, name: "Pump installed", sequence: 4 }, actorUserId);
      await prisma.$transaction((tx) => service.complete(milestone.id, tx));
      await expect(prisma.$transaction((tx) => service.complete(milestone.id, tx))).rejects.toThrow(BadRequestException);
    });

    test("throws NotFoundException for an unknown milestone id", async () => {
      await expect(
        prisma.$transaction((tx) => service.complete("00000000-0000-0000-0000-000000000000", tx)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("markInProgress()", () => {
    test("moves a pending milestone to in_progress, audit-logged", async () => {
      const milestone = await service.create({ waqfId: projectWaqfId, name: "Site clearing", sequence: 5 }, actorUserId);
      const started = await service.markInProgress(milestone.id, actorUserId);
      expect(started.status).toBe("in_progress");

      const logs = await prisma.auditLog.findMany({ where: { entityId: milestone.id, action: "waqf_milestone.started" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, waqfId: projectWaqfId });
    });

    test("rejects a milestone that isn't pending (already in_progress, or already completed)", async () => {
      const milestone = await service.create({ waqfId: projectWaqfId, name: "Materials sourcing", sequence: 6 }, actorUserId);
      await service.markInProgress(milestone.id, actorUserId);
      await expect(service.markInProgress(milestone.id, actorUserId)).rejects.toThrow(BadRequestException);

      const other = await service.create({ waqfId: projectWaqfId, name: "Site handover", sequence: 7 }, actorUserId);
      await prisma.$transaction((tx) => service.complete(other.id, tx));
      await expect(service.markInProgress(other.id, actorUserId)).rejects.toThrow(BadRequestException);
    });

    test("throws NotFoundException for an unknown milestone id", async () => {
      await expect(service.markInProgress("00000000-0000-0000-0000-000000000000", actorUserId)).rejects.toThrow(NotFoundException);
    });
  });

  describe("setEvidence()", () => {
    test("sets evidenceNotes and evidenceFileUrl, audit-logged with a real before/after", async () => {
      const milestone = await service.create({ waqfId: projectWaqfId, name: "Well drilled", sequence: 9 }, actorUserId);

      const withNotes = await service.setEvidence(milestone.id, { evidenceNotes: "Drilled to 40m, tested clean" }, actorUserId);
      expect(withNotes.evidenceNotes).toBe("Drilled to 40m, tested clean");
      expect(withNotes.evidenceFileUrl).toBeNull();

      const withFile = await service.setEvidence(milestone.id, { evidenceFileUrl: "http://localhost:4000/uploads/waqf-milestone-evidence/x.pdf" }, actorUserId);
      // Providing only evidenceFileUrl leaves the previously-set notes alone.
      expect(withFile.evidenceNotes).toBe("Drilled to 40m, tested clean");
      expect(withFile.evidenceFileUrl).toBe("http://localhost:4000/uploads/waqf-milestone-evidence/x.pdf");

      const logs = await prisma.auditLog.findMany({
        where: { entityId: milestone.id, action: "waqf_milestone.evidence_updated" },
        orderBy: { createdAt: "asc" },
      });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, waqfId: projectWaqfId });
    });

    test("allowed after a milestone is already completed — evidence isn't gated by waqf.milestone_complete", async () => {
      const milestone = await service.create({ waqfId: projectWaqfId, name: "Handover", sequence: 10 }, actorUserId);
      await prisma.$transaction((tx) => service.complete(milestone.id, tx));

      const updated = await service.setEvidence(milestone.id, { evidenceNotes: "Final report attached" }, actorUserId);
      expect(updated.status).toBe("completed");
      expect(updated.evidenceNotes).toBe("Final report attached");
    });

    test("throws NotFoundException for an unknown milestone id", async () => {
      await expect(service.setEvidence("00000000-0000-0000-0000-000000000000", { evidenceNotes: "x" }, actorUserId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
