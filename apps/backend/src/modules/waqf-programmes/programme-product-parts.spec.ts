import { prisma, ProgrammeSpendKind, ProgrammeWorksRoute, WaqfProgrammeProduct } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { ClinicClaimsService } from "../clinics/clinic-claims.service";
import { ClinicPriceListsService } from "../clinics/clinic-price-lists.service";
import { ClinicReportsService } from "../clinics/clinic-reports.service";
import { allowsSpendKind, PRODUCTS } from "./programme-products";
import { ProgrammeLedgerService } from "./programme-ledger.service";
import { ProgrammeReserveService } from "./programme-reserve.service";
import { ProgrammeSpendingService } from "./programme-spending.service";
import { WaqfProgrammesService } from "./waqf-programmes.service";

// A product's own parts, and payment kinds it doesn't list, are refused on
// another product (2026-11-18, with the need-based waqf, now Kifayah, as the second
// product): by the services, with a plain message, and by the database.
// Programmes are never deleted (a trigger), so these fixtures stay in the
// dev database, named per run.
describe("waqf programme product parts", () => {
  const programmes = new WaqfProgrammesService();
  const ledger = new ProgrammeLedgerService();
  const priceLists = new ClinicPriceListsService();
  const claims = new ClinicClaimsService(ledger, priceLists);
  const reports = new ClinicReportsService(ledger);
  const spending = new ProgrammeSpendingService(ledger);
  const reserve = new ProgrammeReserveService(ledger);

  let makerUserId: string;
  let checkerUserId: string;
  let needBased: { id: string; name: string };

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `product-parts-${randomUUID()}@example.com`, fullName: "Product Parts Maker" } });
    await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role: "mutawalli_officer" } } } });
    makerUserId = user.id;
    const checker = await prisma.user.create({ data: { email: `product-parts-${randomUUID()}@example.com`, fullName: "Product Parts Checker" } });
    await prisma.birrStaff.create({ data: { userId: checker.id, roles: { create: { role: "board_of_trustees" } } } });
    checkerUserId = checker.id;
    needBased = await programmes.create(
      { product: "need_based", name: "Kano Support Test", slug: `kano-support-${randomUUID().slice(0, 8)}`, city: "Kano", jurisdiction: "NG" },
      makerUserId,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Kifayah (the need_based product)", () => {
    test("is created with its product's default causes and its own deed wording", async () => {
      const found = await prisma.waqfProgramme.findUniqueOrThrow({
        where: { id: needBased.id },
        include: { causes: { include: { causeCategory: { select: { name: true } } } } },
      });
      expect(found.product).toBe("need_based");
      expect(found.causes.map((c) => c.causeCategory.name).sort()).toEqual([...PRODUCTS.need_based.defaultCauses].sort());

      const draft = await programmes.draftDeed(needBased.id, {}, makerUserId);
      expect(draft.text).toContain("Deed of the Kano Support Test waqf");
      expect(draft.text).toContain("The financing fund");
      expect(draft.text).toContain("whose means fall below the kifayah line of their state");
      expect(draft.text).toContain("16. The name. This waqf is called Kifayah");
      expect(draft.text).not.toContain("laboratory and clinic care");
    });

    test("has no works projects, equipment purchases or replacement reserve, only investment placements", () => {
      expect(Object.values(ProgrammeSpendKind).filter((k) => allowsSpendKind({ product: "need_based" }, k))).toEqual(["investment"]);
      expect(Object.values(ProgrammeSpendKind).every((k) => allowsSpendKind({ product: "clinic" }, k))).toBe(true);
    });
  });

  describe("the services refuse a clinic's own parts, with a plain message", () => {
    const refused = async (call: Promise<unknown>, message: RegExp) => {
      await expect(call).rejects.toBeInstanceOf(BadRequestException);
      await expect(call).rejects.toThrow(message);
    };

    test("an operator, monthly figures", async () => {
      await refused(claims.validateOperatorProposal({ programmeId: needBased.id, counterpartyId: randomUUID() }), /Operators belong to clinics only; Kano Support Test is a Kifayah waqf/);
      await refused(
        reports.record(needBased.id, { period: "2026-10", visits: 1, childrenImmunised: 0, testsRun: 0, referrals: 0 }, makerUserId),
        /Monthly figures belong to clinics only/,
      );
    });

    test("a works project and a replacement reserve", async () => {
      await refused(
        spending.proposeWorks(needBased.id, { name: "Shop fit-out", route: Object.values(ProgrammeWorksRoute)[0], contractorId: randomUUID(), budget: "100000", budgetNote: "QS estimate" }, makerUserId),
        /Kano Support Test is a Kifayah waqf, which has no works projects/,
      );
      await refused(reserve.validateShareProposal({ programmeId: needBased.id, percent: 10 }), /which has no equipment replacement reserve/);
    });
  });

  describe("the database agrees with the product list", () => {
    test("on every product's payment kinds", async () => {
      for (const product of Object.values(WaqfProgrammeProduct)) {
        for (const kind of Object.values(ProgrammeSpendKind)) {
          const [row] = await prisma.$queryRaw<{ allowed: boolean }[]>`
            SELECT programme_spend_kind_allowed(${product}::"WaqfProgrammeProduct", ${kind}::"ProgrammeSpendKind") AS "allowed"`;
          expect({ product, kind, allowed: row.allowed }).toEqual({ product, kind, allowed: allowsSpendKind({ product }, kind) });
        }
      }
    });
  });

  describe("the database refuses, whatever the app does", () => {
    test("a clinic's price list or monthly figures on a need-based waqf", async () => {
      const content = JSON.stringify({ services: [] });
      await expect(
        prisma.clinicPriceList.create({
          data: { programmeId: needBased.id, version: 1, content, contentHash: createHash("sha256").update(content, "utf8").digest("hex"), createdByUserId: makerUserId },
        }),
      ).rejects.toThrow(/clinic_price_lists belong to clinics only/);
      await expect(
        prisma.clinicMonthlyReport.create({
          data: { programmeId: needBased.id, period: "2026-10", visits: 1, childrenImmunised: 0, testsRun: 0, referrals: 0, recordedByUserId: makerUserId },
        }),
      ).rejects.toThrow(/clinic_monthly_reports belong to clinics only/);
    });

    test("changing a programme's product, or giving a need-based waqf a replacement reserve", async () => {
      await expect(prisma.waqfProgramme.update({ where: { id: needBased.id }, data: { product: "clinic" } })).rejects.toThrow(/product never changes/);
      // With a decided approval attached, so only the clinic-only rule can refuse it.
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "waqf_programme.reserve_share_set" } });
      const action = await prisma.governedAction.create({
        data: { permissionId: permission.id, makerType: "human", makerUserId, checkerUserId, status: "approved", decidedAt: new Date(), payload: { programmeId: needBased.id, percent: 10 } },
      });
      await expect(
        prisma.$executeRaw`UPDATE "waqf_programmes" SET "reserveSharePercent" = 10, "reserveShareActionId" = ${action.id} WHERE "id" = ${needBased.id}`,
      ).rejects.toThrow(/waqf_programmes_reserve_clinic_only/);
    });
  });
});
