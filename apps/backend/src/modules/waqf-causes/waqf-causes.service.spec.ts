import { prisma, Prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { createWiredWaqfServices } from "./test-support/create-wired-services";

describe("WaqfCausesService", () => {
  const { causesService: service, proceedsService } = createWiredWaqfServices();

  const waqfCauseIds: string[] = [];
  const waqfIds: string[] = [];

  let waqfId: string;
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `waqf-causes-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const foundation = await prisma.foundation.create({
      data: { name: "Waqf Causes Fixture Foundation" },
    });
    const waqf = await prisma.waqf.create({
      data: { name: "Waqf Causes Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);
  });

  afterAll(async () => {
    await prisma.waqfCause.deleteMany({ where: { id: { in: waqfCauseIds } } });
    await prisma.waqfProceeds.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("create() writes an audit_logs record attributed to the calling birr_staff, not \"system\"", async () => {
    const cause = await service.create({ waqfId, name: "Teacher Training" }, actorUserId);
    waqfCauseIds.push(cause.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: cause.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "WaqfCause",
      action: "waqf_cause.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });

  describe("allocate()", () => {
    // Reuses the outer describe's wired proceedsService/service pair
    // (closure) — no separate, unwired instance needed now that
    // record() calls back into WaqfCausesService.

    let founderId: string;
    let otherFounderId: string;
    let categoryId: string;

    let assetWaqfId: string;
    let assetCauseId: string;
    let secondAssetCauseId: string;

    let investmentWaqfId: string;
    let investmentCauseId: string;

    let customCauseId: string;

    beforeAll(async () => {
      const founder = await prisma.founder.create({ data: { name: "Allocate Fixture Founder", kind: "institution" } });
      founderId = founder.id;
      const otherFounder = await prisma.founder.create({ data: { name: "Allocate Fixture Other Founder", kind: "institution" } });
      otherFounderId = otherFounder.id;

      const category = await prisma.causeCategory.create({
        data: { name: `Allocate Fixture Category ${randomUUID()}`, typicalWaqfTypes: [] },
      });
      categoryId = category.id;

      const foundation = await prisma.foundation.create({ data: { name: "Allocate Fixture Foundation" } });
      await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId } });

      // Asset-type waqf — allocates from live amountRaised (confirmed
      // Contributions), no proceeds concept.
      const assetWaqf = await prisma.waqf.create({
        data: { name: "Allocate Fixture Asset Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
      });
      assetWaqfId = assetWaqf.id;
      waqfIds.push(assetWaqf.id);
      await prisma.contribution.create({
        data: {
          waqfId: assetWaqfId,
          amount: "1000",
          currency: "USD",
          provider: "paystack",
          providerReference: `allocate-spec-${randomUUID()}`,
          status: "confirmed",
        },
      });

      const assetCause = await prisma.waqfCause.create({
        data: { waqfId: assetWaqfId, causeCategoryId: categoryId, name: category.name },
      });
      assetCauseId = assetCause.id;
      waqfCauseIds.push(assetCause.id);

      const secondCategory = await prisma.causeCategory.create({
        data: { name: `Allocate Fixture Category 2 ${randomUUID()}`, typicalWaqfTypes: [] },
      });
      const secondAssetCause = await prisma.waqfCause.create({
        data: { waqfId: assetWaqfId, causeCategoryId: secondCategory.id, name: secondCategory.name },
      });
      secondAssetCauseId = secondAssetCause.id;
      waqfCauseIds.push(secondAssetCause.id);

      const customCause = await prisma.waqfCause.create({
        data: { waqfId: assetWaqfId, name: "Staff Custom Cause" },
      });
      customCauseId = customCause.id;
      waqfCauseIds.push(customCause.id);

      // Investment-type waqf — allocation still comes from amountRaised,
      // same as every other waqf type. A large WaqfProceeds figure is
      // recorded here specifically to prove it's ignored: proceeds are a
      // separate staff-reporting concept (see WaqfProceedsService's own
      // comment) with no bearing on Cause Allocation.
      const investmentWaqf = await prisma.waqf.create({
        data: { name: "Allocate Fixture Investment Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      investmentWaqfId = investmentWaqf.id;
      waqfIds.push(investmentWaqf.id);
      await proceedsService.record(
        { waqfId: investmentWaqfId, amount: "5000", currency: "USD", description: "Fixture proceeds (should be ignored)" },
        actorUserId,
      );
      await prisma.contribution.create({
        data: {
          waqfId: investmentWaqfId,
          amount: "300",
          currency: "USD",
          provider: "paystack",
          providerReference: `allocate-spec-investment-${randomUUID()}`,
          status: "confirmed",
        },
      });

      const investmentCause = await prisma.waqfCause.create({
        data: { waqfId: investmentWaqfId, causeCategoryId: categoryId, name: category.name },
      });
      investmentCauseId = investmentCause.id;
      waqfCauseIds.push(investmentCause.id);
    });

    test("allocates from live amountRaised for a non-Investment waqf", async () => {
      const updated = await service.allocate(assetCauseId, founderId, "400");
      expect(updated.allocatedAmount?.toString()).toBe("400");

      const logs = await prisma.auditLog.findMany({ where: { entityId: assetCauseId, action: "waqf_cause.allocation_set" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "founder_user" });
    });

    test("rejects an allocation that would exceed the waqf's total pool across its causes", async () => {
      // assetCauseId already holds 400 of the 1000 raised; 700 more would
      // push the waqf's total allocated past what's actually available.
      await expect(service.allocate(secondAssetCauseId, founderId, "700")).rejects.toThrow(BadRequestException);

      // Exactly the remaining 600 succeeds.
      const updated = await service.allocate(secondAssetCauseId, founderId, "600");
      expect(updated.allocatedAmount?.toString()).toBe("600");
    });

    test("allocates from amountRaised even for an Investment-type waqf, ignoring its recorded proceeds", async () => {
      // Only 300 was actually raised (the fixture's 5000 WaqfProceeds
      // entry must play no part) — asking for more than that fails...
      await expect(service.allocate(investmentCauseId, founderId, "301")).rejects.toThrow(BadRequestException);

      // ...but exactly what was raised succeeds.
      const updated = await service.allocate(investmentCauseId, founderId, "300");
      expect(updated.allocatedAmount?.toString()).toBe("300");
    });

    test("rejects a founder who doesn't own the waqf", async () => {
      await expect(service.allocate(assetCauseId, otherFounderId, "1")).rejects.toThrow(NotFoundException);
    });

    test("rejects allocating against a Birr-staff custom cause (no causeCategoryId)", async () => {
      await expect(service.allocate(customCauseId, founderId, "1")).rejects.toThrow(NotFoundException);
    });
  });

  describe("allocateProceeds()", () => {
    let proceedsFoundationId: string;
    let proceedsWaqfId: string;
    let firstCauseId: string;
    let secondCauseId: string;
    let assetCauseForProceedsId: string;

    beforeAll(async () => {
      const foundation = await prisma.foundation.create({ data: { name: "Allocate Proceeds Fixture Foundation" } });
      proceedsFoundationId = foundation.id;

      // Investment-type waqf with a 1000 WaqfProceeds pool — the ceiling
      // allocateProceeds() checks against, completely separate from any
      // Contribution/amountRaised figure (which allocate() alone cares
      // about).
      const proceedsWaqf = await prisma.waqf.create({
        data: { name: "Allocate Proceeds Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      proceedsWaqfId = proceedsWaqf.id;
      waqfIds.push(proceedsWaqf.id);
      await proceedsService.record(
        { waqfId: proceedsWaqfId, amount: "1000", currency: "USD", description: "Fixture proceeds" },
        actorUserId,
      );

      // Given a causeCategoryId (unlike secondCause below) specifically
      // so the "independent pools" test can also exercise allocate()
      // (Founder self-service, corpus-based) against this same cause —
      // allocate() only recognizes catalog-linked causes.
      const category = await prisma.causeCategory.create({
        data: { name: `Allocate Proceeds Fixture Category ${randomUUID()}`, typicalWaqfTypes: [] },
      });
      const firstCause = await prisma.waqfCause.create({
        data: { waqfId: proceedsWaqfId, causeCategoryId: category.id, name: category.name },
      });
      firstCauseId = firstCause.id;
      waqfCauseIds.push(firstCause.id);

      const secondCause = await prisma.waqfCause.create({
        data: { waqfId: proceedsWaqfId, name: "Proceeds Fixture Cause 2" },
      });
      secondCauseId = secondCause.id;
      waqfCauseIds.push(secondCause.id);

      // waqfId (top-level fixture) is Asset-type — reused here to prove
      // allocateProceeds() rejects a waqf with no investment layer.
      const assetCause = await prisma.waqfCause.create({
        data: { waqfId, name: "Asset Waqf Cause For Proceeds Rejection" },
      });
      assetCauseForProceedsId = assetCause.id;
      waqfCauseIds.push(assetCause.id);
    });

    test("sets proceedsAllocatedAmount and writes an audit_logs record attributed to birr_staff", async () => {
      const updated = await service.allocateProceeds(firstCauseId, actorUserId, "400");
      expect(updated.proceedsAllocatedAmount?.toString()).toBe("400");

      const logs = await prisma.auditLog.findMany({
        where: { entityId: firstCauseId, action: "waqf_cause.proceeds_allocation_set" },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId });
    });

    test("rejects an allocation that would exceed the waqf's recorded proceeds across its causes", async () => {
      // firstCauseId already holds 400 of the 1000 recorded; 700 more
      // would push the waqf's total proceeds-allocation past what was
      // actually recorded.
      await expect(service.allocateProceeds(secondCauseId, actorUserId, "700")).rejects.toThrow(BadRequestException);

      // Exactly the remaining 600 succeeds.
      const updated = await service.allocateProceeds(secondCauseId, actorUserId, "600");
      expect(updated.proceedsAllocatedAmount?.toString()).toBe("600");
    });

    test("rejects allocating proceeds against a non-Investment-type waqf", async () => {
      await expect(service.allocateProceeds(assetCauseForProceedsId, actorUserId, "1")).rejects.toThrow(
        BadRequestException,
      );
    });

    test("corpus allocation and proceeds allocation are independent pools with no shared headroom", async () => {
      // firstCauseId currently holds proceedsAllocatedAmount 400 (from
      // above) and no corpus allocation yet. Setting a corpus allocation
      // via allocate() must not touch or be constrained by that 400, and
      // vice versa — proven by both succeeding at their own full pool
      // size despite the other pool being fully committed.
      const founder = await prisma.founder.create({ data: { name: "Independent Pools Fixture Founder", kind: "institution" } });
      await prisma.foundationFounder.create({ data: { foundationId: proceedsFoundationId, founderId: founder.id } });
      await prisma.contribution.create({
        data: {
          waqfId: proceedsWaqfId,
          amount: "50",
          currency: "USD",
          provider: "paystack",
          providerReference: `allocate-proceeds-spec-corpus-${randomUUID()}`,
          status: "confirmed",
        },
      });

      // Corpus pool is only 50 — allocate() succeeds up to 50 on
      // firstCauseId, unaffected by its existing 400 proceeds-allocation.
      const corpusUpdated = await service.allocate(firstCauseId, founder.id, "50");
      expect(corpusUpdated.allocatedAmount?.toString()).toBe("50");

      // Proceeds pool remains exactly as it was — setting corpus above
      // didn't consume any of the 1000 proceeds pool.
      await expect(service.allocateProceeds(firstCauseId, actorUserId, "400")).resolves.toMatchObject({
        proceedsAllocatedAmount: expect.anything(),
      });
    });

    test("succeeds against a custom cause (no causeCategoryId) — unlike allocate(), which rejects those", async () => {
      const customProceedsCause = await prisma.waqfCause.create({
        data: { waqfId: proceedsWaqfId, name: "Custom Cause For Proceeds" },
      });
      waqfCauseIds.push(customProceedsCause.id);

      // Pool is fully committed by this point (400 + 600 already set
      // above) — 0 is still a valid, in-range allocation, proving the
      // call reaches the ceiling check rather than being rejected purely
      // for lacking a causeCategoryId (which is what allocate() does).
      const updated = await service.allocateProceeds(customProceedsCause.id, actorUserId, "0");
      expect(updated.proceedsAllocatedAmount?.toString()).toBe("0");
    });
  });

  describe("allocateProceedsProportionally()", () => {
    let proportionalWaqfId: string;
    let assetWaqfForProportionalId: string;

    beforeAll(async () => {
      const foundation = await prisma.foundation.create({ data: { name: "Allocate Proceeds Proportionally Fixture Foundation" } });

      const waqf = await prisma.waqf.create({
        data: { name: "Allocate Proceeds Proportionally Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      proportionalWaqfId = waqf.id;
      waqfIds.push(waqf.id);

      const assetWaqf = await prisma.waqf.create({
        data: { name: "Proportional Fixture Asset Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
      });
      assetWaqfForProportionalId = assetWaqf.id;
      waqfIds.push(assetWaqf.id);
    });

    test("splits the recorded proceeds pool 60/40, matching each cause's own corpus allocation ratio", async () => {
      // Mirrors the user's own example exactly: N100,000 raised,
      // 60,000/40,000 allocated to Cause A/B → any recorded proceeds
      // split 60%/40% the same way.
      const causeA = await prisma.waqfCause.create({
        data: { waqfId: proportionalWaqfId, name: "Proportional Cause A", allocatedAmount: "60000" },
      });
      const causeB = await prisma.waqfCause.create({
        data: { waqfId: proportionalWaqfId, name: "Proportional Cause B", allocatedAmount: "40000" },
      });
      waqfCauseIds.push(causeA.id, causeB.id);

      // Raw insert, not proceedsService.record() — record() now auto-
      // triggers allocateProceedsProportionally() itself (see its own
      // comment), and this test wants to exercise exactly one explicit
      // call to that method in isolation, not a redundant second one.
      await prisma.waqfProceeds.create({
        data: { waqfId: proportionalWaqfId, amount: "1000", currency: "USD", description: "Fixture return", recordedByUserId: actorUserId },
      });

      const [updatedA, updatedB] = await service.allocateProceedsProportionally(proportionalWaqfId, actorUserId);
      const byId = new Map([updatedA, updatedB].map((c) => [c.id, c]));
      expect(byId.get(causeA.id)!.proceedsAllocatedAmount?.toString()).toBe("600");
      expect(byId.get(causeB.id)!.proceedsAllocatedAmount?.toString()).toBe("400");

      const logs = await prisma.auditLog.findMany({
        where: { entityId: causeA.id, action: "waqf_cause.proceeds_allocated_proportionally" },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId });
    });

    test("sums to the pool exactly even when the ratio doesn't divide evenly, and gives a zero-corpus cause nothing", async () => {
      const foundation = await prisma.foundation.create({ data: { name: "Proportional Uneven Fixture Foundation" } });
      const waqf = await prisma.waqf.create({
        data: { name: "Proportional Uneven Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      waqfIds.push(waqf.id);

      const causeA = await prisma.waqfCause.create({ data: { waqfId: waqf.id, name: "Uneven Cause A", allocatedAmount: "1" } });
      const causeB = await prisma.waqfCause.create({ data: { waqfId: waqf.id, name: "Uneven Cause B", allocatedAmount: "2" } });
      // No corpus allocation at all — weight 0, should receive 0.
      const causeC = await prisma.waqfCause.create({ data: { waqfId: waqf.id, name: "Uneven Cause C" } });
      waqfCauseIds.push(causeA.id, causeB.id, causeC.id);

      await proceedsService.record(
        { waqfId: waqf.id, amount: "10", currency: "USD", description: "Fixture uneven return" },
        actorUserId,
      );

      const updated = await service.allocateProceedsProportionally(waqf.id, actorUserId);
      const byId = new Map(updated.map((c) => [c.id, c]));
      const sum = updated.reduce((s, c) => s.plus(c.proceedsAllocatedAmount ?? 0), new Prisma.Decimal(0));
      expect(sum.toString()).toBe("10");
      expect(byId.get(causeC.id)!.proceedsAllocatedAmount?.toString()).toBe("0");
    });

    test("rejects a non-Investment-type waqf", async () => {
      const cause = await prisma.waqfCause.create({ data: { waqfId: assetWaqfForProportionalId, name: "Should Not Split", allocatedAmount: "1" } });
      waqfCauseIds.push(cause.id);
      await expect(
        service.allocateProceedsProportionally(assetWaqfForProportionalId, actorUserId),
      ).rejects.toThrow(BadRequestException);
    });

    test("rejects a waqf with no causes at all", async () => {
      const foundation = await prisma.foundation.create({ data: { name: "No Causes Fixture Foundation" } });
      const waqf = await prisma.waqf.create({
        data: { name: "No Causes Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      waqfIds.push(waqf.id);

      await expect(service.allocateProceedsProportionally(waqf.id, actorUserId)).rejects.toThrow(BadRequestException);
    });

    test("re-running it recomputes from scratch rather than topping up", async () => {
      const foundation = await prisma.foundation.create({ data: { name: "Rerun Fixture Foundation" } });
      const waqf = await prisma.waqf.create({
        data: { name: "Rerun Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      waqfIds.push(waqf.id);
      const cause = await prisma.waqfCause.create({ data: { waqfId: waqf.id, name: "Rerun Cause", allocatedAmount: "1" } });
      waqfCauseIds.push(cause.id);

      await proceedsService.record(
        { waqfId: waqf.id, amount: "100", currency: "USD", description: "First return" },
        actorUserId,
      );
      const [firstRun] = await service.allocateProceedsProportionally(waqf.id, actorUserId);
      expect(firstRun!.proceedsAllocatedAmount?.toString()).toBe("100");

      await proceedsService.record(
        { waqfId: waqf.id, amount: "50", currency: "USD", description: "Second return" },
        actorUserId,
      );
      const [secondRun] = await service.allocateProceedsProportionally(waqf.id, actorUserId);
      // 150 total pool now, one cause holding 100% of the (only) corpus
      // weight — recomputed to 150, not 100 + 50 double-counted or
      // additively topped up.
      expect(secondRun!.proceedsAllocatedAmount?.toString()).toBe("150");
    });
  });
});
