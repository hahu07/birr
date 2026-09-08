import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { prisma } from "@birr/db";
import { WaqfsService } from "./waqfs.service";
import { TrusteeLicensesService } from "../trustee-licenses/trustee-licenses.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { FinancialReportsService } from "../financial-reports/financial-reports.service";
import { DistributionsService } from "../distributions/distributions.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { WaqfProceedsService } from "../waqf-proceeds/waqf-proceeds.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import {
  FakePaystackPayoutAdapter,
  createFakeStripePayoutAdapter,
  createFakeStablecoinPayoutAdapter,
} from "../distributions/test-support/fake-payout-adapters";

describe("WaqfsService", () => {
  if (!process.env.SETTINGS_ENCRYPTION_KEY) {
    process.env.SETTINGS_ENCRYPTION_KEY = "0".repeat(64);
  }

  const service = new WaqfsService(new TrusteeLicensesService(createFakeNotificationsService()), createFakeNotificationsService());
  // Only used by the "generating a financial report" test below — a
  // Project-type waqf never calls WaqfProceedsService.sumForWaqf() (see
  // that method's own waqf.type === "investment" gate), so a bare
  // placeholder here is safe, same reasoning
  // createWiredWaqfServices' own comment gives for its cycle-breaking
  // pattern.
  const financialReportsService = new FinancialReportsService(
    new DistributionsService(
      new BeneficiariesService(new EncryptionService()),
      createFakeNotificationsService(),
      createFakeStripePayoutAdapter() as any,
      new FakePaystackPayoutAdapter() as any,
      createFakeStablecoinPayoutAdapter() as any,
    ),
    new WaqfProceedsService(undefined as any),
  );

  const waqfIds: string[] = [];

  let founderAId: string;
  let founderBId: string;
  let foundationAId: string;
  let waqfAId: string;
  let waqfBId: string;

  beforeAll(async () => {
    const founderA = await prisma.founder.create({
      data: { name: "Waqfs List Founder A", kind: "institution" },
    });
    founderAId = founderA.id;
    const founderB = await prisma.founder.create({
      data: { name: "Waqfs List Founder B", kind: "institution" },
    });
    founderBId = founderB.id;

    // Each fixture waqf gets its own Foundation, mirroring the fact that
    // a founder relationship is now derived transitively via
    // foundationId -> foundation_founders, not a direct join on Waqf.
    const foundationA = await prisma.foundation.create({
      data: { name: "Waqfs List Foundation A" },
    });
    foundationAId = foundationA.id;
    await prisma.foundationFounder.create({
      data: { foundationId: foundationA.id, founderId: founderAId },
    });
    const foundationB = await prisma.foundation.create({
      data: { name: "Waqfs List Foundation B" },
    });
    await prisma.foundationFounder.create({
      data: { foundationId: foundationB.id, founderId: founderBId },
    });

    const waqfA = await prisma.waqf.create({
      data: {
        name: "Waqfs List Test Waqf A",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundationA.id,
      },
    });
    waqfAId = waqfA.id;
    waqfIds.push(waqfA.id);

    const waqfB = await prisma.waqf.create({
      data: {
        name: "Waqfs List Test Waqf B",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundationB.id,
      },
    });
    waqfBId = waqfB.id;
    waqfIds.push(waqfB.id);
  });

  afterAll(async () => {
    // Founders/Foundations are left in place, same reasoning as every
    // other spec — simplest to not chase FK cleanup for rows nothing
    // else depends on.
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("list(founderId) sets app.current_founder_id and returns only that founder's waqfs — proves the RLS policy and the WHERE clause are both actually live for this call, not just the WHERE clause alone", async () => {
    // If founder_isolation ever regresses to denying all rows (the exact
    // empty-string gotcha fixed earlier this session), this would come
    // back empty instead of exactly one row, even though the WHERE
    // clause alone would still find it.
    const resultsForA = await service.list(founderAId);
    expect(resultsForA.map((w) => w.id)).toEqual([waqfAId]);
    // Founder Portal groups its waqf list by Foundation — this field
    // must actually be populated, not just present on the type.
    expect(resultsForA[0].foundation.name).toBe("Waqfs List Foundation A");

    const resultsForB = await service.list(founderBId);
    expect(resultsForB.map((w) => w.id)).toEqual([waqfBId]);
  });

  test("list() with no founderId is unrestricted (internal/ops-console path unchanged)", async () => {
    const all = await service.list();
    const ids = all.map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining([waqfAId, waqfBId]));
    const waqfA = all.find((w) => w.id === waqfAId)!;
    expect(waqfA.foundation.name).toBe("Waqfs List Foundation A");
  });

  test("findByIdForFounder() resolves the caller's own waqf but returns null for another founder's waqf", async () => {
    const own = await service.findByIdForFounder(waqfAId, founderAId);
    expect(own?.id).toBe(waqfAId);

    // The RLS-leak this closes: without founder scoping, findById() would
    // happily return Founder B's waqf to Founder A's session.
    const other = await service.findByIdForFounder(waqfBId, founderAId);
    expect(other).toBeNull();
  });

  test("createSelfService() creates the waqf and audit-logs it against the calling founder when they own the foundation", async () => {
    const waqf = await service.createSelfService({
      name: "Self Service Waqf",
      type: "asset",
      jurisdiction: "AE",
      foundationId: foundationAId,
      founderId: founderAId,
      corpusAmount: "5000",
      corpusCurrency: "USD",
      fundingPlan: "lump_sum",
    });
    waqfIds.push(waqf.id);

    expect(waqf.foundationId).toBe(foundationAId);

    const logs = await prisma.auditLog.findMany({ where: { entityId: waqf.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "waqf.created",
      actorType: "founder_user",
      actorFounderId: founderAId,
    });
  });

  test("createSelfService() rejects a founder creating a waqf under a foundation that isn't theirs", async () => {
    // founderB attempting to create a waqf under founderA's Foundation —
    // the security-critical ownership check this whole self-service path
    // depends on: without it, any founder could create a waqf under any
    // other founder's Foundation just by guessing/enumerating an id.
    await expect(
      service.createSelfService({
        name: "Should Be Rejected",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundationAId,
        founderId: founderBId,
        corpusAmount: "5000",
        corpusCurrency: "USD",
        fundingPlan: "lump_sum",
      }),
    ).rejects.toThrow(ForbiddenException);

    const created = await prisma.waqf.findFirst({ where: { name: "Should Be Rejected" } });
    expect(created).toBeNull();
  });

  test("createSelfService() rejects a declared corpus below the configured minimum for that currency", async () => {
    await expect(
      service.createSelfService({
        name: "Corpus Too Small",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundationAId,
        founderId: founderAId,
        corpusAmount: "1",
        corpusCurrency: "USD",
        fundingPlan: "lump_sum",
      }),
    ).rejects.toThrow(BadRequestException);

    const created = await prisma.waqf.findFirst({ where: { name: "Corpus Too Small" } });
    expect(created).toBeNull();
  });

  test("createSelfService() rejects when the founder's primary_contact hasn't verified their email", async () => {
    const unverifiedUser = await prisma.user.create({
      data: { email: `waqfs-spec-unverified-${randomUUID()}@example.test`, fullName: "Unverified Contact" },
    });
    const unverifiedFounder = await prisma.founder.create({
      data: { name: "Waqfs Spec Unverified Founder", kind: "individual" },
    });
    await prisma.founderMembership.create({
      data: { founderId: unverifiedFounder.id, userId: unverifiedUser.id, permissionLevel: "primary_contact" },
    });
    const foundation = await prisma.foundation.create({
      data: { name: "Waqfs Spec Unverified Foundation", purpose: "Testing" },
    });
    await prisma.foundationFounder.create({
      data: { foundationId: foundation.id, founderId: unverifiedFounder.id },
    });

    await expect(
      service.createSelfService({
        name: "Should Be Blocked",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundation.id,
        founderId: unverifiedFounder.id,
        corpusAmount: "5000",
        corpusCurrency: "USD",
        fundingPlan: "lump_sum",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  describe("increaseCorpusTarget()", () => {
    let corpusWaqfId: string;

    beforeAll(async () => {
      const waqf = await prisma.waqf.create({
        data: {
          name: "Increase Corpus Target Waqf",
          type: "asset",
          jurisdiction: "AE",
          foundationId: foundationAId,
          corpusAmount: "5000",
          corpusCurrency: "USD",
        },
      });
      corpusWaqfId = waqf.id;
      waqfIds.push(waqf.id);
    });

    test("raises the corpus target and audit-logs the change against the calling founder", async () => {
      const updated = await service.increaseCorpusTarget(corpusWaqfId, founderAId, "7500");
      expect(updated.corpusAmount?.toString()).toBe("7500");

      const logs = await prisma.auditLog.findMany({ where: { entityId: corpusWaqfId, action: "waqf.corpus_target_increased" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "founder_user", actorFounderId: founderAId });
    });

    test("rejects a new target at or below the current one", async () => {
      await expect(service.increaseCorpusTarget(corpusWaqfId, founderAId, "7500")).rejects.toThrow(BadRequestException);
      await expect(service.increaseCorpusTarget(corpusWaqfId, founderAId, "1000")).rejects.toThrow(BadRequestException);
    });

    test("rejects a founder who doesn't own the waqf", async () => {
      await expect(service.increaseCorpusTarget(corpusWaqfId, founderBId, "9000")).rejects.toThrow(NotFoundException);
    });

    test("rejects a waqf with no corpus target to increase", async () => {
      const noCorpusWaqf = await prisma.waqf.create({
        data: { name: "No Corpus Waqf", type: "asset", jurisdiction: "AE", foundationId: foundationAId },
      });
      waqfIds.push(noCorpusWaqf.id);

      await expect(service.increaseCorpusTarget(noCorpusWaqf.id, founderAId, "1000")).rejects.toThrow(BadRequestException);
    });

    test("rejects a dissolved waqf", async () => {
      const dissolvedWaqf = await prisma.waqf.create({
        data: {
          name: "Dissolved Waqf",
          type: "asset",
          jurisdiction: "AE",
          foundationId: foundationAId,
          corpusAmount: "5000",
          corpusCurrency: "USD",
          status: "dissolved",
        },
      });
      waqfIds.push(dissolvedWaqf.id);

      await expect(service.increaseCorpusTarget(dissolvedWaqf.id, founderAId, "9000")).rejects.toThrow(BadRequestException);
    });
  });

  describe("getLifecycleStatus()", () => {
    let projectWaqfId: string;
    let investmentWaqfId: string;
    let lifecycleStaffUserId: string;
    const policySetJurisdictions: string[] = [];

    beforeAll(async () => {
      // Fixture User/BirrStaff not cleaned up — same reasoning as every
      // other spec in this codebase.
      const staffUser = await prisma.user.create({
        data: { email: `waqfs-lifecycle-staff-${Date.now()}@example.com`, fullName: "Lifecycle Fixture Staff" },
      });
      lifecycleStaffUserId = staffUser.id;
      await prisma.birrStaff.create({ data: { userId: lifecycleStaffUserId, staffRole: "mutawalli_officer" } });

      // Distinct, unlikely-to-collide jurisdiction codes — the shared dev
      // DB already has a real CompliancePolicySet for "AE", which would
      // silently make complianceMonitoring "complete" from the start.
      const projectWaqf = await prisma.waqf.create({
        data: { name: "Lifecycle Fixture Project Waqf", type: "project", jurisdiction: "ZZ", foundationId: foundationAId },
      });
      projectWaqfId = projectWaqf.id;
      waqfIds.push(projectWaqfId);

      const investmentWaqf = await prisma.waqf.create({
        data: { name: "Lifecycle Fixture Investment Waqf", type: "investment", jurisdiction: "ZY", foundationId: foundationAId },
      });
      investmentWaqfId = investmentWaqf.id;
      waqfIds.push(investmentWaqfId);
    });

    afterAll(async () => {
      await prisma.compliancePolicySet.deleteMany({ where: { jurisdiction: { in: policySetJurisdictions } } });
    });

    test("a fresh Project waqf: every trackable stage pending except establishment and long-term preservation; investment management is not_applicable; succession management is not_available", async () => {
      const status = await service.getLifecycleStatus(projectWaqfId);
      expect(status!.stages.establishment.status).toBe("complete");
      expect(status!.stages.legalDocumentation.status).toBe("pending");
      expect(status!.stages.assetRegistration.status).toBe("pending");
      expect(status!.stages.governanceConfiguration.status).toBe("pending");
      expect(status!.stages.investmentManagement.status).toBe("not_applicable");
      expect(status!.stages.beneficiaryAdministration.status).toBe("pending");
      expect(status!.stages.distributionManagement.status).toBe("pending");
      expect(status!.stages.complianceMonitoring.status).toBe("pending");
      // "pending", not "not_available" — FinancialReportsService now
      // exists; this stage is checked for real (no financial report has
      // been generated for this fixture waqf yet).
      expect(status!.stages.financialReporting.status).toBe("pending");
      expect(status!.stages.impactMeasurement.status).toBe("pending");
      // "pending", not "complete" — this fixture waqf was inserted
      // directly via prisma.waqf.create() (raw, bypassing
      // WaqfsService.createSelfService()), which is the only place
      // that actually writes an audit_logs row on creation. Confirms
      // getLifecycleStatus() checks real audit_logs rows rather than
      // assuming every waqf has one.
      expect(status!.stages.audit.status).toBe("pending");
      expect(status!.stages.successionManagement.status).toBe("not_available");
      // Always complete, unconditionally — see waqfs.service.ts's own
      // comment (the 2026-08-30 going-concern policy decision resolved
      // this one, not deferred it).
      expect(status!.stages.longTermPreservation.status).toBe("complete");
      // 11 trackable stages (13 minus the 1 always-not_available —
      // successionManagement — minus the 1 not_applicable-for-Project
      // investmentManagement); establishment and longTermPreservation
      // are complete from the start, everything else pending.
      expect(status!.trackableCount).toBe(11);
      expect(status!.completedCount).toBe(2);
    });

    test("generating a financial report flips financialReporting to complete", async () => {
      await financialReportsService.generate(projectWaqfId, { actorType: "birr_staff", actorUserId: lifecycleStaffUserId });

      const status = await service.getLifecycleStatus(projectWaqfId);
      expect(status!.stages.financialReporting).toMatchObject({ status: "complete", count: 1 });
    });

    test("returns null for a waqf that doesn't exist", async () => {
      const status = await service.getLifecycleStatus(randomUUID());
      expect(status).toBeNull();
    });

    test("registering an asset flips assetRegistration to complete with the right count", async () => {
      const asset = await prisma.asset.create({
        data: { waqfId: projectWaqfId, name: "Lifecycle Fixture Asset", category: "cash", estimatedValue: "100", currency: "USD" },
      });
      const status = await service.getLifecycleStatus(projectWaqfId);
      expect(status!.stages.assetRegistration).toMatchObject({ status: "complete", count: 1 });
      await prisma.asset.delete({ where: { id: asset.id } });
    });

    test("a matching CompliancePolicySet flips complianceMonitoring to complete", async () => {
      await prisma.compliancePolicySet.create({
        data: { jurisdiction: "ZZ", frameworkName: "Lifecycle Fixture Framework" },
      });
      policySetJurisdictions.push("ZZ");

      const status = await service.getLifecycleStatus(projectWaqfId);
      expect(status!.stages.complianceMonitoring).toMatchObject({ status: "complete", frameworkName: "Lifecycle Fixture Framework" });
    });

    test("investment management is genuinely trackable (not not_applicable) on an Investment-type waqf", async () => {
      const before = await service.getLifecycleStatus(investmentWaqfId);
      expect(before!.stages.investmentManagement.status).toBe("pending");

      const counterparty = await prisma.counterparty.create({
        data: { name: "Lifecycle Fixture Counterparty", institutionType: "bank", jurisdiction: "AE", status: "active" },
      });
      const investment = await prisma.investment.create({
        data: {
          waqfId: investmentWaqfId,
          name: "Lifecycle Fixture Investment",
          counterpartyId: counterparty.id,
          instrumentType: "sukuk",
          allocatedAmount: "100",
          currency: "USD",
        },
      });

      const after = await service.getLifecycleStatus(investmentWaqfId);
      expect(after!.stages.investmentManagement).toMatchObject({ status: "complete", count: 1 });

      await prisma.investment.delete({ where: { id: investment.id } });
      await prisma.counterparty.delete({ where: { id: counterparty.id } });
    });
  });
});
