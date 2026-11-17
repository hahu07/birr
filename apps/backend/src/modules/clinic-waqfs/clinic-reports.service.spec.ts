import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { lagosToday } from "../counterparties/counterparty-licenses.service";
import { ClinicLedgerService } from "./clinic-ledger.service";
import { ClinicPriceListsService } from "./clinic-price-lists.service";
import { ClinicReportsService } from "./clinic-reports.service";
import { ClinicWaqfsService } from "./clinic-waqfs.service";

// Clinic waqfs, reports, claims and ledgers are never deleted (triggers),
// so these fixtures stay in the dev database. The one zakah distribution
// is rejected afterwards so it commits nothing.
describe("ClinicReportsService", () => {
  const ledger = new ClinicLedgerService();
  const service = new ClinicReportsService(ledger);
  const clinics = new ClinicWaqfsService();
  const lists = new ClinicPriceListsService();
  const month = lagosToday().slice(0, 7);

  let recorderUserId: string;
  let publisherUserId: string;

  async function staff(role: "mutawalli_officer" | "compliance_officer", label: string) {
    const user = await prisma.user.create({ data: { email: `clinic-reports-${label}-${randomUUID()}@example.com`, fullName: `Clinic ${label}` } });
    await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role } } } });
    return user.id;
  }

  // A decided governed action to hang an approval on: the engine itself is
  // covered by governed-actions.service.spec.ts.
  async function decidedAction(key: string, payload: object) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
    return prisma.governedAction.create({
      data: { permissionId: permission.id, makerType: "human", makerUserId: recorderUserId, checkerUserId: publisherUserId, status: "approved", decidedAt: new Date(), payload },
    });
  }

  async function newClinic(established = true) {
    const created = await clinics.create({ name: "Report Test Clinic", slug: `report-clinic-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" }, recorderUserId);
    if (!established) return created;
    const draft = await clinics.draftDeed(created.id, {}, recorderUserId);
    const deedPayload = { deedId: draft.id, textHash: draft.textHash };
    const deedAction = await decidedAction("clinic_waqf.deed_approve", deedPayload);
    await prisma.$transaction((tx) => clinics.approveDeed(deedPayload, deedAction.id, publisherUserId, tx));
    const establishAction = await decidedAction("clinic_waqf.establish", { clinicWaqfId: created.id });
    await prisma.$transaction((tx) => clinics.establish({ clinicWaqfId: created.id }, establishAction.id, tx));
    return created;
  }

  const figures = (period = month) => ({ period, visits: 420, childrenImmunised: 96, testsRun: 310, referrals: 12 });

  beforeAll(async () => {
    recorderUserId = await staff("mutawalli_officer", "recorder");
    publisherUserId = await staff("compliance_officer", "publisher");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("one person records a month's figures; someone else publishes them", async () => {
    const clinic = await newClinic();
    await expect(service.record(clinic.id, figures("2999-01"), recorderUserId)).rejects.toThrow(BadRequestException);
    const report = await service.record(clinic.id, figures(), recorderUserId);
    await expect(service.record(clinic.id, figures(), recorderUserId)).rejects.toThrow(ConflictException);
    await expect(service.publish(clinic.id, report.id, recorderUserId)).rejects.toThrow(ForbiddenException);

    const published = await service.publish(clinic.id, report.id, publisherUserId);
    expect(published).toMatchObject({ status: "published", publishedByUserId: publisherUserId });
    expect(await prisma.auditLog.count({ where: { entityId: report.id, action: { in: ["clinic_report.recorded", "clinic_report.published"] } } })).toBe(2);
    await expect(service.record(clinic.id, figures(), recorderUserId)).rejects.toThrow(/already published/);
    await expect(service.discard(clinic.id, report.id, recorderUserId)).rejects.toThrow(/already published/);
  });

  test("the database refuses the recorder as publisher, changed figures, going back and deleting", async () => {
    const clinic = await newClinic();
    const report = await service.record(clinic.id, figures(), recorderUserId);
    await expect(
      prisma.clinicMonthlyReport.update({ where: { id: report.id }, data: { status: "published", publishedByUserId: recorderUserId, publishedAt: new Date() } }),
    ).rejects.toThrow(/publisher_not_recorder/);
    await expect(prisma.clinicMonthlyReport.update({ where: { id: report.id }, data: { visits: 9999 } })).rejects.toThrow(/never change/);
    await service.discard(clinic.id, report.id, recorderUserId);
    await expect(prisma.clinicMonthlyReport.update({ where: { id: report.id }, data: { status: "draft" } })).rejects.toThrow(/can't go from/);
    await expect(prisma.clinicMonthlyReport.delete({ where: { id: report.id } })).rejects.toThrow(/never deleted/);
    // A discarded draft frees the month.
    await expect(service.record(clinic.id, figures(), recorderUserId)).resolves.toMatchObject({ status: "draft" });
  });

  test("the public report shows each pot separately, published figures only, and subsidies from approved claims", async () => {
    await expect(service.publicReport(`no-such-clinic-${randomUUID().slice(0, 6)}`)).rejects.toThrow(NotFoundException);
    const draftClinic = await newClinic(false);
    await expect(service.publicReport(draftClinic.slug)).rejects.toThrow(NotFoundException);

    const clinic = await newClinic();
    await clinics.update(clinic.id, { endowmentTarget: "50000000", runningMonthlyTarget: "4000000" }, recorderUserId);
    await expect(clinics.update(clinic.id, { endowmentTarget: "1.234" }, recorderUserId)).rejects.toThrow(/naira and kobo/);
    const post = (description: string, lines: { accountCode: string; debit?: string; credit?: string }[]) =>
      prisma.$transaction((tx) => ledger.post(tx, { clinicWaqfId: clinic.id, description, currency: "NGN", source: "manual_adjustment", actorType: "system", lines }));
    await post("Endowed gifts", [{ accountCode: "1000", debit: "500000" }, { accountCode: "3000", credit: "500000" }]);
    await post("Running gifts", [{ accountCode: "1100", debit: "80000" }, { accountCode: "4000", credit: "80000" }]);
    await post("Endowment income", [{ accountCode: "1100", debit: "5000" }, { accountCode: "4100", credit: "5000" }]);

    // A draft month stays private; a published one shows.
    const draft = await service.record(clinic.id, figures(), recorderUserId);
    expect((await service.publicReport(clinic.slug)).months).toEqual([]);
    await service.publish(clinic.id, draft.id, publisherUserId);

    // An approved claim: two subsidised visits, one of them zakah.
    const list = await lists.draft(
      clinic.id,
      {
        services: [
          { code: "ANC", name: "Antenatal tests", price: "18500" },
          { code: "FBC", name: "Full blood count", price: "2500" },
        ],
        bands: [{ code: "A", name: "Poorest", whoQualifies: "Household income under ₦50,000 a month", patientSharePercent: 0 }],
        monthlySubsidyCap: "100000",
      },
      recorderUserId,
    );
    const listAction = await decidedAction("clinic_waqf.price_list_approve", { priceListId: list.id, contentHash: list.contentHash });
    await prisma.$transaction((tx) => lists.approve({ priceListId: list.id, contentHash: list.contentHash }, listAction.id, tx));
    const operator = await prisma.counterparty.create({
      data: { name: `Report Test Operator ${randomUUID()}`, institutionType: "healthcare_provider", jurisdiction: "NG", status: "active" },
    });
    const claimAction = await decidedAction("clinic_waqf.claim_approve", {});
    const claim = await prisma.$transaction(async (tx) => {
      const c = await tx.clinicClaim.create({
        data: {
          clinicWaqfId: clinic.id,
          period: month,
          operatorId: operator.id,
          priceListId: list.id,
          lineCount: 3,
          totalPrice: 39500,
          patientPaid: 0,
          subsidyTotal: 39500,
          runningFundAmount: 18500,
          zakahAmount: 21000,
          createdByUserId: recorderUserId,
        },
      });
      const visitDate = new Date(`${month}-01T00:00:00Z`);
      await tx.clinicClaimLine.createMany({
        data: [
          { claimId: c.id, clinicWaqfId: clinic.id, visitReference: "R1", visitDate, serviceCode: "ANC", bandCode: "A", price: 18500, patientPaid: 0, subsidy: 18500, zakahEligible: false },
          { claimId: c.id, clinicWaqfId: clinic.id, visitReference: "R2", visitDate, serviceCode: "ANC", bandCode: "A", price: 18500, patientPaid: 0, subsidy: 18500, zakahEligible: true },
          { claimId: c.id, clinicWaqfId: clinic.id, visitReference: "R2", visitDate, serviceCode: "FBC", bandCode: "A", price: 2500, patientPaid: 0, subsidy: 2500, zakahEligible: true },
        ],
      });
      return tx.clinicClaim.update({ where: { id: c.id }, data: { status: "approved", approvalActionId: claimAction.id, approvedAt: new Date() } });
    });
    // A linked zakah distribution counts only once it's paid.
    const distribution = await prisma.zakahDistribution.create({
      data: { counterpartyId: operator.id, category: "fuqara", amount: 21000, currency: "NGN", reason: "Report fixture.", createdByUserId: recorderUserId },
    });
    try {
      await prisma.clinicClaim.update({ where: { id: claim.id }, data: { zakahDistributionId: distribution.id } });
      const report = await service.publicReport(clinic.slug);
      expect(report.targets).toEqual({ endowment: "50000000.00", runningMonthly: "4000000.00" });
      expect(report.endowment).toMatchObject({ endowed: "500000.00", cash: "500000.00", invested: "0.00" });
      expect(report.running).toMatchObject({ gifts: "80000.00", endowmentIncome: "5000.00", receivedThisMonth: "85000.00", cash: "85000.00" });
      expect(report.zakah.paidForPatients).toBe("0.00");
      expect(report.months).toEqual([
        {
          period: month,
          figures: { visits: 420, childrenImmunised: 96, testsRun: 310, referrals: 12 },
          subsidised: {
            patients: 2,
            byService: [
              { service: "Antenatal tests", visits: 2 },
              { service: "Full blood count", visits: 1 },
            ],
            fromRunningFund: "18500.00",
            fromZakah: "21000.00",
          },
        },
      ]);
      // Nothing about any giver, patient or member of staff.
      const text = JSON.stringify(report);
      for (const secret of ["R1", "R2", recorderUserId, publisherUserId, operator.id]) expect(text).not.toContain(secret);
    } finally {
      await prisma.zakahDistribution.update({ where: { id: distribution.id }, data: { status: "rejected" } });
    }
  });
});
