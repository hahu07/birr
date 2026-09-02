import { prisma } from "@birr/db";
import { NotFoundException } from "@nestjs/common";
import { CauseImpactUpdatesService } from "./cause-impact-updates.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";

describe("CauseImpactUpdatesService", () => {
  const service = new CauseImpactUpdatesService(createFakeNotificationsService());

  const waqfIds: string[] = [];
  const impactUpdateIds: string[] = [];

  let actorUserId: string;
  let founderId: string;
  let otherFounderId: string;
  let waqfCauseId: string;
  let waqfId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references,
    // insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `cause-impact-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const founder = await prisma.founder.create({ data: { name: "Cause Impact Fixture Founder", kind: "institution" } });
    founderId = founder.id;
    const otherFounder = await prisma.founder.create({ data: { name: "Cause Impact Fixture Other Founder", kind: "institution" } });
    otherFounderId = otherFounder.id;

    const foundation = await prisma.foundation.create({ data: { name: "Cause Impact Fixture Foundation" } });
    await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId } });

    const waqf = await prisma.waqf.create({
      data: { name: "Cause Impact Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);

    const waqfCause = await prisma.waqfCause.create({
      data: { waqfId, name: "Cause Impact Fixture Cause" },
    });
    waqfCauseId = waqfCause.id;
  });

  afterAll(async () => {
    await prisma.causeImpactUpdate.deleteMany({ where: { id: { in: impactUpdateIds } } });
    await prisma.waqfCause.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("create() writes the row, trims text fields, and writes a matching audit_logs record", async () => {
    const update = await service.create(
      {
        waqfCauseId,
        periodLabel: "  Q1 2026  ",
        narrative: "  Great progress this quarter.  ",
        metricValue: 42,
        metricLabel: "  families reached  ",
      },
      actorUserId,
    );
    impactUpdateIds.push(update.id);

    expect(update.periodLabel).toBe("Q1 2026");
    expect(update.narrative).toBe("Great progress this quarter.");
    expect(update.metricLabel).toBe("families reached");
    expect(update.metricValue).toBe(42);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: update.id, action: "cause_impact_update.created" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ waqfId, actorType: "birr_staff", actorUserId, entityType: "CauseImpactUpdate" });
  });

  test("create() rejects an unknown waqfCauseId", async () => {
    await expect(
      service.create(
        { waqfCauseId: "00000000-0000-0000-0000-000000000000", periodLabel: "Q1 2026", narrative: "Fixture." },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  test("list() returns updates for the given cause, most recent first", async () => {
    const second = await service.create(
      { waqfCauseId, periodLabel: "Q2 2026", narrative: "Second update." },
      actorUserId,
    );
    impactUpdateIds.push(second.id);

    const list = await service.list(waqfCauseId);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].id).toBe(second.id);
  });

  test("listForFounder() returns updates when the founder owns the cause's waqf", async () => {
    const list = await service.listForFounder(waqfCauseId, founderId);
    expect(list).not.toBeNull();
    expect(list!.length).toBeGreaterThan(0);
  });

  test("listForFounder() returns null for a founder who doesn't own the cause's waqf", async () => {
    const list = await service.listForFounder(waqfCauseId, otherFounderId);
    expect(list).toBeNull();
  });

  test("listAllForFounder() returns updates across every waqf the founder owns", async () => {
    const list = await service.listAllForFounder(founderId);
    expect(list.some((u) => u.waqfCauseId === waqfCauseId)).toBe(true);
  });

  test("listAllForFounder() is empty for a founder with no impact updates", async () => {
    const list = await service.listAllForFounder(otherFounderId);
    expect(list).toHaveLength(0);
  });
});
