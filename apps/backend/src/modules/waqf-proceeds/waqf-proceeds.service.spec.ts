import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createWiredWaqfServices } from "../waqf-causes/test-support/create-wired-services";

describe("WaqfProceedsService", () => {
  const { proceedsService: service } = createWiredWaqfServices();

  const waqfIds: string[] = [];
  const proceedsIds: string[] = [];

  let waqfId: string;
  let investmentId: string;
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `waqf-proceeds-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const foundation = await prisma.foundation.create({ data: { name: "Waqf Proceeds Fixture Foundation" } });
    const waqf = await prisma.waqf.create({
      data: { name: "Waqf Proceeds Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);

    const investment = await prisma.investment.create({
      data: { waqfId, name: "Fixture Sukuk", instrumentType: "sukuk", allocatedAmount: "10000" },
    });
    investmentId = investment.id;
  });

  afterAll(async () => {
    await prisma.waqfProceeds.deleteMany({ where: { id: { in: proceedsIds } } });
    await prisma.investment.deleteMany({ where: { id: investmentId } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("record() creates the row and audit-logs it against the calling staff member", async () => {
    const proceeds = await service.record(
      { waqfId, investmentId, amount: "500", currency: "USD", description: "Q3 2026 sukuk return" },
      actorUserId,
    );
    proceedsIds.push(proceeds.id);

    expect(proceeds.amount.toString()).toBe("500");

    const logs = await prisma.auditLog.findMany({ where: { entityId: proceeds.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "WaqfProceeds",
      action: "waqf_proceeds.recorded",
      actorType: "birr_staff",
      actorUserId,
    });
  });

  test("record() allows a waqf-level entry with no specific investment", async () => {
    const proceeds = await service.record(
      { waqfId, amount: "200", currency: "USD", description: "Unattributed return" },
      actorUserId,
    );
    proceedsIds.push(proceeds.id);
    expect(proceeds.investmentId).toBeNull();
  });

  test("record() rejects an investmentId that doesn't belong to the given waqf", async () => {
    const otherFoundation = await prisma.foundation.create({ data: { name: "Waqf Proceeds Other Foundation" } });
    const otherWaqf = await prisma.waqf.create({
      data: { name: "Waqf Proceeds Other Waqf", type: "investment", jurisdiction: "AE", foundationId: otherFoundation.id },
    });
    waqfIds.push(otherWaqf.id);

    await expect(
      service.record(
        { waqfId: otherWaqf.id, investmentId, amount: "100", currency: "USD", description: "Mismatched" },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  test("sumForWaqf() totals every recorded entry for the waqf", async () => {
    const total = await service.sumForWaqf(waqfId);
    expect(total.toString()).toBe("700");
  });

  test("record() rejects a non-Investment-type waqf", async () => {
    const foundation = await prisma.foundation.create({ data: { name: "Waqf Proceeds Asset Fixture Foundation" } });
    const assetWaqf = await prisma.waqf.create({
      data: { name: "Waqf Proceeds Asset Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfIds.push(assetWaqf.id);

    await expect(
      service.record(
        { waqfId: assetWaqf.id, amount: "100", currency: "USD", description: "Should be rejected" },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  describe("automatic proportional reallocation on record()", () => {
    // Confirmed with the user directly: this used to be manual-only
    // ("staff clicks a button"), changed here at their later request —
    // every successful record() now re-runs WaqfCausesService
    // .allocateProceedsProportionally() for the same waqf.
    test("updates each cause's proceedsAllocatedAmount to match the fund's own corpus allocation ratio", async () => {
      const foundation = await prisma.foundation.create({ data: { name: "Auto Reallocate Fixture Foundation" } });
      const waqf = await prisma.waqf.create({
        data: { name: "Auto Reallocate Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      waqfIds.push(waqf.id);
      const causeA = await prisma.waqfCause.create({
        data: { waqfId: waqf.id, name: "Auto Reallocate Cause A", allocatedAmount: "70" },
      });
      const causeB = await prisma.waqfCause.create({
        data: { waqfId: waqf.id, name: "Auto Reallocate Cause B", allocatedAmount: "30" },
      });

      const proceeds = await service.record(
        { waqfId: waqf.id, amount: "1000", currency: "USD", description: "Auto-reallocate fixture return" },
        actorUserId,
      );
      proceedsIds.push(proceeds.id);

      const [updatedA, updatedB] = await Promise.all([
        prisma.waqfCause.findUniqueOrThrow({ where: { id: causeA.id } }),
        prisma.waqfCause.findUniqueOrThrow({ where: { id: causeB.id } }),
      ]);
      expect(updatedA.proceedsAllocatedAmount?.toString()).toBe("700");
      expect(updatedB.proceedsAllocatedAmount?.toString()).toBe("300");

      await prisma.waqfCause.deleteMany({ where: { id: { in: [causeA.id, causeB.id] } } });
    });

    test("does not fail the request when the waqf has no causes yet — the recorded row still persists", async () => {
      const foundation = await prisma.foundation.create({ data: { name: "No Causes Yet Fixture Foundation" } });
      const waqf = await prisma.waqf.create({
        data: { name: "No Causes Yet Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      waqfIds.push(waqf.id);

      const proceeds = await service.record(
        { waqfId: waqf.id, amount: "50", currency: "USD", description: "No causes yet" },
        actorUserId,
      );
      proceedsIds.push(proceeds.id);
      expect(proceeds.amount.toString()).toBe("50");
    });
  });
});
