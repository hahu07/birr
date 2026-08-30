import { prisma } from "@birr/db";
import { NotFoundException } from "@nestjs/common";
import { FinancialReportsService } from "./financial-reports.service";
import { DistributionsService } from "../distributions/distributions.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import {
  FakePaystackPayoutAdapter,
  createFakeStripePayoutAdapter,
  createFakeStablecoinPayoutAdapter,
} from "../distributions/test-support/fake-payout-adapters";
import { createWiredWaqfServices } from "../waqf-causes/test-support/create-wired-services";

describe("FinancialReportsService", () => {
  if (!process.env.SETTINGS_ENCRYPTION_KEY) {
    process.env.SETTINGS_ENCRYPTION_KEY = "0".repeat(64);
  }

  const encryption = new EncryptionService();
  const distributionsService = new DistributionsService(
    new BeneficiariesService(encryption),
    createFakeNotificationsService(),
    createFakeStripePayoutAdapter() as any,
    new FakePaystackPayoutAdapter() as any,
    createFakeStablecoinPayoutAdapter() as any,
  );
  const { proceedsService } = createWiredWaqfServices();
  const service = new FinancialReportsService(distributionsService, proceedsService);

  const waqfIds: string[] = [];
  const foundationIds: string[] = [];

  let projectWaqfId: string;
  let projectCauseId: string;
  let projectBeneficiaryId: string;
  let founderId: string;
  let otherFounderId: string;
  let staffUserId: string;
  let founderUserId: string;

  let investmentWaqfId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff/Founder rows not cleaned up in afterAll —
    // same reasoning as every other spec in this codebase.
    const staffUser = await prisma.user.create({
      data: { email: `financial-reports-staff-${Date.now()}@example.com`, fullName: "Test Staff" },
    });
    staffUserId = staffUser.id;
    await prisma.birrStaff.create({ data: { userId: staffUserId, staffRole: "mutawalli_officer" } });

    const founderUser = await prisma.user.create({
      data: { email: `financial-reports-founder-${Date.now()}@example.com`, fullName: "Test Founder User" },
    });
    founderUserId = founderUser.id;

    const founder = await prisma.founder.create({ data: { name: "Financial Reports Fixture Founder", kind: "institution" } });
    founderId = founder.id;
    await prisma.founderMembership.create({
      data: { founderId, userId: founderUserId, permissionLevel: "primary_contact", status: "active" },
    });

    const otherFounder = await prisma.founder.create({ data: { name: "Financial Reports Other Founder", kind: "institution" } });
    otherFounderId = otherFounder.id;

    const foundation = await prisma.foundation.create({ data: { name: "Financial Reports Fixture Foundation" } });
    foundationIds.push(foundation.id);
    await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId } });

    const projectWaqf = await prisma.waqf.create({
      data: { name: "Financial Reports Fixture Project Waqf", type: "project", jurisdiction: "AE", foundationId: foundation.id },
    });
    projectWaqfId = projectWaqf.id;
    waqfIds.push(projectWaqfId);

    await prisma.contribution.create({
      data: {
        waqfId: projectWaqfId,
        amount: "1000",
        currency: "USD",
        provider: "paystack",
        providerReference: `financial-reports-spec-${projectWaqfId}`,
        status: "confirmed",
      },
    });

    const cause = await prisma.waqfCause.create({
      data: { waqfId: projectWaqfId, name: "Fixture Cause", allocatedAmount: "500" },
    });
    projectCauseId = cause.id;

    const beneficiary = await prisma.beneficiary.create({
      data: { waqfId: projectWaqfId, causeId: cause.id, name: "Fixture Beneficiary", eligibilityCriteria: "N/A" },
    });
    projectBeneficiaryId = beneficiary.id;

    // Direct insert, not through approve()/initiateDisbursement — this
    // spec is about FinancialReportsService's own composition, not the
    // payout lifecycle (that's DistributionsService's own, already
    // thoroughly tested, concern).
    await prisma.distribution.create({
      data: {
        waqfId: projectWaqfId,
        causeId: cause.id,
        beneficiaryId: beneficiary.id,
        amount: "300",
        currency: "USD",
        status: "paid",
      },
    });

    const investmentWaqf = await prisma.waqf.create({
      data: { name: "Financial Reports Fixture Investment Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
    });
    investmentWaqfId = investmentWaqf.id;
    waqfIds.push(investmentWaqfId);

    await prisma.waqfProceeds.create({
      data: { waqfId: investmentWaqfId, amount: "150", currency: "USD", description: "Fixture proceeds", recordedByUserId: staffUserId },
    });
  });

  afterAll(async () => {
    await prisma.distribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.beneficiary.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqfCause.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqfProceeds.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.foundationFounder.deleteMany({ where: { foundationId: { in: foundationIds } } });
    await prisma.foundation.deleteMany({ where: { id: { in: foundationIds } } });
    await prisma.$disconnect();
  });

  test("generate() for a Project waqf: correct raised/distributed totals, proceeds null, writes an audit log", async () => {
    const report = await service.generate(projectWaqfId, { actorType: "birr_staff", actorUserId: staffUserId });

    expect(report.raised).toHaveLength(1);
    expect(report.raised[0].currency).toBe("USD");
    expect(report.raised[0].totalAmount.toString()).toBe("1000");
    expect(report.distributed).toHaveLength(1);
    expect(report.distributed[0].currency).toBe("USD");
    expect(report.distributed[0].totalAmount.toString()).toBe("300");
    expect(report.proceeds).toBeNull();

    expect(report.distributionsByCause).toHaveLength(1);
    expect(report.distributionsByCause[0]).toMatchObject({ causeId: projectCauseId, currency: "USD", distributionCount: 1, beneficiaryCount: 1 });
    // No beneficiary names — this report is shared verbatim between both
    // dashboards, so it stays uniformly PII-safe.
    expect((report.distributionsByCause[0] as any).beneficiaryNames).toBeUndefined();

    expect(report.causeAllocations).toEqual([
      expect.objectContaining({ id: projectCauseId, name: "Fixture Cause" }),
    ]);

    const logs = await prisma.auditLog.findMany({ where: { waqfId: projectWaqfId, action: "financial_report.exported" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: staffUserId });
  });

  test("generate() for an Investment waqf includes real proceeds", async () => {
    const report = await service.generate(investmentWaqfId, { actorType: "birr_staff", actorUserId: staffUserId });
    expect(report.proceeds).not.toBeNull();
    expect(report.proceeds!.total.toString()).toBe("150");
  });

  test("generate() as a founder_user writes an audit log with actorFounderId set", async () => {
    await service.generate(projectWaqfId, { actorType: "founder_user", actorUserId: founderUserId, founderId });

    const logs = await prisma.auditLog.findMany({
      where: { waqfId: projectWaqfId, action: "financial_report.exported", actorType: "founder_user" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorUserId: founderUserId, actorFounderId: founderId });
  });

  test("generate() as a founder_user rejects a waqf that isn't theirs", async () => {
    await expect(
      service.generate(projectWaqfId, { actorType: "founder_user", actorUserId: founderUserId, founderId: otherFounderId }),
    ).rejects.toThrow(NotFoundException);
  });

  test("generate() rejects a waqf that doesn't exist", async () => {
    await expect(
      service.generate("00000000-0000-0000-0000-000000000000", { actorType: "birr_staff", actorUserId: staffUserId }),
    ).rejects.toThrow(NotFoundException);
  });
});
