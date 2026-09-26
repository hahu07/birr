import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { InvestmentsService } from "./investments.service";

describe("InvestmentsService", () => {
  const service = new InvestmentsService();

  const investmentIds: string[] = [];
  const waqfIds: string[] = [];

  let waqfId: string;
  let actorUserId: string;
  let activeCounterpartyId: string;
  let pendingCounterpartyId: string;
  let founderId: string;
  let otherFounderId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `investments-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const foundation = await prisma.foundation.create({
      data: { name: "Investments Fixture Foundation" },
    });
    const waqf = await prisma.waqf.create({
      data: { name: "Investments Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);
    // A waqf can't invest more than it's actually raised — this fixture
    // needs real confirmed Contributions to allocate against.
    await prisma.contribution.create({
      data: {
        waqfId,
        amount: "2000",
        currency: "USD",
        provider: "paystack",
        providerReference: `investments-spec-${randomUUID()}`,
        status: "confirmed",
      },
    });

    const activeCounterparty = await prisma.counterparty.create({
      data: { name: `Investments Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
    });
    activeCounterpartyId = activeCounterparty.id;
    const pendingCounterparty = await prisma.counterparty.create({
      data: { name: `Investments Fixture Pending Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE" },
    });
    pendingCounterpartyId = pendingCounterparty.id;

    // A second, unrelated Founder for listForFounder()'s own isolation
    // test below — same convention as AssetsService.listForFounder's spec.
    const founder = await prisma.founder.create({ data: { name: "Investments Fixture Founder", kind: "institution" } });
    founderId = founder.id;
    await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId } });
    const otherFounder = await prisma.founder.create({
      data: { name: "Investments Fixture Other Founder", kind: "institution" },
    });
    otherFounderId = otherFounder.id;
  });

  afterAll(async () => {
    // RESTRICT on investmentId, must go before Investment itself.
    await prisma.shariahScreening.deleteMany({ where: { investmentId: { in: investmentIds } } });
    await prisma.investment.deleteMany({ where: { id: { in: investmentIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: [activeCounterpartyId, pendingCounterpartyId] } } });
    await prisma.$disconnect();
  });

  test("create() writes the investment and a matching audit_logs record, with currency derived from the waqf's own corpusCurrency", async () => {
    const investment = await service.create(
      { waqfId, name: "Fixture Investment", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: activeCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
      actorUserId,
    );
    investmentIds.push(investment.id);
    // Never client-supplied — see Investment.currency's own schema comment.
    expect(investment.currency).toBe("USD");

    const logs = await prisma.auditLog.findMany({ where: { entityId: investment.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "Investment",
      action: "investment.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });

  test("create() rejects a waqf with no declared corpus currency yet", async () => {
    const foundation = await prisma.foundation.create({ data: { name: "Investments No-Currency Fixture Foundation" } });
    const noCurrencyWaqf = await prisma.waqf.create({
      data: { name: "Investments No-Currency Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfIds.push(noCurrencyWaqf.id);

    await expect(
      service.create(
        { waqfId: noCurrencyWaqf.id, name: "Should Not Be Created", instrumentType: "sukuk", allocatedAmount: "100", counterpartyId: activeCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() rejects an Investment against a non-Investment-type waqf", async () => {
    const foundation = await prisma.foundation.create({ data: { name: "Investments Fixture Foundation (Asset)" } });
    const assetWaqf = await prisma.waqf.create({
      data: { name: "Investments Fixture Asset Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfIds.push(assetWaqf.id);

    await expect(
      service.create(
        { waqfId: assetWaqf.id, name: "Should Be Rejected", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId: activeCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    const created = await prisma.investment.findFirst({ where: { name: "Should Be Rejected" } });
    expect(created).toBeNull();
  });

  test("create() rejects committing more than the waqf's raised amount across its investments", async () => {
    // 1000 already committed (the first test above) out of 2000 raised —
    // 1500 more would push the total past what's actually been raised.
    await expect(
      service.create(
        { waqfId, name: "Should Exceed Raised", instrumentType: "sukuk", allocatedAmount: "1500", counterpartyId: activeCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    // Exactly the remaining 1000 succeeds.
    const investment = await service.create(
      { waqfId, name: "Second Fixture Investment", instrumentType: "equity_fund", allocatedAmount: "1000", counterpartyId: activeCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
      actorUserId,
    );
    investmentIds.push(investment.id);
  });

  test("changeAllocation() re-checks the ceiling and rejects raising past what's raised", async () => {
    const investment = await prisma.investment.findFirstOrThrow({ where: { waqfId, name: "Second Fixture Investment" } });

    // The waqf's 2000 raised is now fully committed (1000 + 1000) —
    // raising this one to 1500 would push the total to 2500.
    await prisma.$transaction(async (tx) => {
      await expect(service.changeAllocation(investment.id, "1500", tx)).rejects.toThrow(BadRequestException);
    });

    // Lowering it stays within the ceiling and succeeds.
    const updated = await prisma.$transaction((tx) => service.changeAllocation(investment.id, "500", tx));
    expect(updated.allocatedAmount.toString()).toBe("500");
  });

  test("create() rejects a counterparty that hasn't been onboarded yet", async () => {
    await expect(
      service.create(
        { waqfId, name: "Should Be Rejected", instrumentType: "sukuk", allocatedAmount: "1", counterpartyId: pendingCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    const created = await prisma.investment.findFirst({ where: { name: "Should Be Rejected" } });
    expect(created).toBeNull();
  });

  describe("concentration limit — enforced across every waqf combined", () => {
    let limitedCounterpartyId: string;
    let firstWaqfId: string;
    let secondWaqfId: string;

    beforeAll(async () => {
      const counterparty = await prisma.counterparty.create({
        data: {
          name: `Investments Fixture Limited Bank ${randomUUID()}`,
          institutionType: "bank",
          jurisdiction: "AE",
          status: "active",
          concentrationLimit: "1500",
          concentrationLimitCurrency: "USD",
        },
      });
      limitedCounterpartyId = counterparty.id;

      const foundation = await prisma.foundation.create({ data: { name: "Investments Fixture Foundation (Concentration)" } });
      const [firstWaqf, secondWaqf] = await Promise.all([
        prisma.waqf.create({
          data: { name: "Investments Fixture First Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
        }),
        prisma.waqf.create({
          data: { name: "Investments Fixture Second Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
        }),
      ]);
      firstWaqfId = firstWaqf.id;
      secondWaqfId = secondWaqf.id;
      waqfIds.push(firstWaqfId, secondWaqfId);
      await Promise.all(
        [firstWaqfId, secondWaqfId].map((id) =>
          prisma.contribution.create({
            data: {
              waqfId: id,
              amount: "5000",
              currency: "USD",
              provider: "paystack",
              providerReference: `investments-spec-concentration-${id}`,
              status: "confirmed",
            },
          }),
        ),
      );
    });

    afterAll(async () => {
      await prisma.counterparty.deleteMany({ where: { id: limitedCounterpartyId } });
    });

    test("rejects a second waqf's investment that would push combined exposure past the limit", async () => {
      const first = await service.create(
        { waqfId: firstWaqfId, name: "First Waqf's Investment", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: limitedCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      investmentIds.push(first.id);

      // 1000 already committed (a different waqf) out of a 1500 limit —
      // 600 more from THIS waqf would push combined exposure to 1600.
      await expect(
        service.create(
          { waqfId: secondWaqfId, name: "Second Waqf's Investment", instrumentType: "sukuk", allocatedAmount: "600", counterpartyId: limitedCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      // Exactly the remaining 500 succeeds.
      const second = await service.create(
        { waqfId: secondWaqfId, name: "Second Waqf's Investment", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId: limitedCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      investmentIds.push(second.id);
    });
  });

  // Regression coverage for the 2026-08-31 codebase audit finding:
  // Investment has no currency field of its own (it inherits its waqf's
  // corpusCurrency) — a prior version of assertWithinConcentrationLimit
  // summed allocatedAmount across every waqf regardless of currency, so
  // a SAR investment could silently blend into (and wrongly exhaust) a
  // USD-denominated concentration limit.
  describe("concentration limit — scoped to its own currency, not blended across currencies", () => {
    let limitedCounterpartyId: string;
    let usdWaqfId: string;
    let sarWaqfId: string;

    beforeAll(async () => {
      const counterparty = await prisma.counterparty.create({
        data: {
          name: `Investments Fixture Currency Bank ${randomUUID()}`,
          institutionType: "bank",
          jurisdiction: "AE",
          status: "active",
          concentrationLimit: "1500",
          concentrationLimitCurrency: "USD",
        },
      });
      limitedCounterpartyId = counterparty.id;

      const foundation = await prisma.foundation.create({ data: { name: "Investments Fixture Foundation (Currency)" } });
      const [usdWaqf, sarWaqf] = await Promise.all([
        prisma.waqf.create({
          data: {
            name: "Investments Fixture USD Waqf",
            type: "investment",
            jurisdiction: "AE",
            foundationId: foundation.id,
            corpusCurrency: "USD",
          },
        }),
        prisma.waqf.create({
          data: {
            name: "Investments Fixture SAR Waqf",
            type: "investment",
            jurisdiction: "AE",
            foundationId: foundation.id,
            corpusCurrency: "SAR",
          },
        }),
      ]);
      usdWaqfId = usdWaqf.id;
      sarWaqfId = sarWaqf.id;
      waqfIds.push(usdWaqfId, sarWaqfId);
      await Promise.all(
        [
          { id: usdWaqfId, currency: "USD" },
          { id: sarWaqfId, currency: "SAR" },
        ].map(({ id, currency }) =>
          prisma.contribution.create({
            data: {
              waqfId: id,
              amount: "5000",
              currency,
              provider: "paystack",
              providerReference: `investments-spec-currency-${id}`,
              status: "confirmed",
            },
          }),
        ),
      );
    });

    afterAll(async () => {
      await prisma.counterparty.deleteMany({ where: { id: limitedCounterpartyId } });
    });

    test("a SAR investment doesn't count against a USD concentration limit, and vice versa", async () => {
      // 1400 SAR through this counterparty — if this wrongly counted
      // against the 1500 USD limit, the USD investment below would be
      // rejected as "only 100 remaining" instead of succeeding at 1500.
      const sarInvestment = await service.create(
        { waqfId: sarWaqfId, name: "SAR Waqf's Investment", instrumentType: "sukuk", allocatedAmount: "1400", counterpartyId: limitedCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      investmentIds.push(sarInvestment.id);

      const usdInvestment = await service.create(
        { waqfId: usdWaqfId, name: "USD Waqf's Investment", instrumentType: "sukuk", allocatedAmount: "1500", counterpartyId: limitedCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      investmentIds.push(usdInvestment.id);

      // Now genuinely at the USD limit — 1 more USD should be rejected,
      // confirming the check still enforces same-currency exposure for
      // real (this isn't a no-op that always passes).
      await expect(
        service.create(
          { waqfId: usdWaqfId, name: "Should Be Rejected", instrumentType: "sukuk", allocatedAmount: "1", counterpartyId: limitedCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("Shariah screening", () => {
    let screeningWaqfId: string;
    let screeningCounterpartyId: string;

    beforeAll(async () => {
      const foundation = await prisma.foundation.create({ data: { name: "Shariah Screening Fixture Foundation" } });
      const waqf = await prisma.waqf.create({
        data: { name: "Shariah Screening Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
      });
      screeningWaqfId = waqf.id;
      waqfIds.push(waqf.id);
      await prisma.contribution.create({
        data: {
          waqfId: screeningWaqfId,
          amount: "5000",
          currency: "USD",
          provider: "paystack",
          providerReference: `investments-shariah-spec-${randomUUID()}`,
          status: "confirmed",
        },
      });
      const counterparty = await prisma.counterparty.create({
        data: { name: `Shariah Screening Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
      });
      screeningCounterpartyId = counterparty.id;
    });

    afterAll(async () => {
      await prisma.counterparty.deleteMany({ where: { id: screeningCounterpartyId } });
    });

    test("create() starts an investment at pending_shariah_review with a ShariahScreening row on file", async () => {
      const investment = await service.create(
        {
          waqfId: screeningWaqfId,
          name: "Fresh Sukuk",
          instrumentType: "sukuk",
          allocatedAmount: "500",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
        },
        actorUserId,
      );
      investmentIds.push(investment.id);
      expect(investment.status).toBe("pending_shariah_review");

      const screening = await prisma.shariahScreening.findUnique({ where: { investmentId: investment.id } });
      expect(screening?.businessDescription).toBe("A sukuk backed by a portfolio of ijara leases on commercial real estate.");
      expect(screening?.decision).toBeNull();
    });

    test("recordShariahScreening() approve → status becomes active, decision recorded, audit-logged", async () => {
      const investment = await service.create(
        {
          waqfId: screeningWaqfId,
          name: "Approve Fixture Sukuk",
          instrumentType: "sukuk",
          allocatedAmount: "300",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
        },
        actorUserId,
      );
      investmentIds.push(investment.id);

      const updated = await service.recordShariahScreening(
        investment.id,
        { decision: "approved", interestBearingDebtConcern: false, nonCompliantIncomeConcern: false, reviewerNotes: "Clean sukuk structure, no concerns." },
        actorUserId,
      );
      expect(updated.status).toBe("active");

      const screening = await prisma.shariahScreening.findUnique({ where: { investmentId: investment.id } });
      expect(screening).toMatchObject({ decision: "approved", reviewerNotes: "Clean sukuk structure, no concerns.", decidedByUserId: actorUserId });
      expect(screening?.decidedAt).not.toBeNull();

      const logs = await prisma.auditLog.findMany({ where: { entityId: investment.id, action: "investment.shariah_approved" } });
      expect(logs).toHaveLength(1);
    });

    test("recordShariahScreening() reject → status becomes shariah_rejected, flagged sectors recorded, audit-logged", async () => {
      const sector = await prisma.shariahProhibitedSector.findFirst({ where: { name: "Gambling" } });
      const investment = await service.create(
        {
          waqfId: screeningWaqfId,
          name: "Reject Fixture Sukuk",
          instrumentType: "equity_fund",
          allocatedAmount: "200",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "An equity fund with meaningful exposure to online casino operators.",
        },
        actorUserId,
      );
      investmentIds.push(investment.id);

      const updated = await service.recordShariahScreening(
        investment.id,
        {
          decision: "rejected",
          interestBearingDebtConcern: false,
          nonCompliantIncomeConcern: true,
          flaggedSectorIds: sector ? [sector.id] : [],
          reviewerNotes: "Material gambling-sector revenue — not Shariah-compliant.",
        },
        actorUserId,
      );
      expect(updated.status).toBe("shariah_rejected");

      const screening = await prisma.shariahScreening.findUnique({ where: { investmentId: investment.id } });
      expect(screening?.decision).toBe("rejected");
      if (sector) expect(screening?.flaggedSectorIds).toContain(sector.id);

      const logs = await prisma.auditLog.findMany({ where: { entityId: investment.id, action: "investment.shariah_rejected" } });
      expect(logs).toHaveLength(1);
    });

    test("recordShariahScreening() rejects a second decision on an already-decided screening", async () => {
      const investment = await service.create(
        {
          waqfId: screeningWaqfId,
          name: "Already Decided Fixture Sukuk",
          instrumentType: "sukuk",
          allocatedAmount: "100",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
        },
        actorUserId,
      );
      investmentIds.push(investment.id);
      await service.recordShariahScreening(investment.id, { decision: "approved", reviewerNotes: "First decision." }, actorUserId);

      await expect(
        service.recordShariahScreening(investment.id, { decision: "rejected", reviewerNotes: "Too late." }, actorUserId),
      ).rejects.toThrow("already been decided");
    });

    test("a pending_shariah_review investment still counts toward the raised-corpus ceiling, not just active ones", async () => {
      // 5000 raised for screeningWaqfId. Prior tests in this block left:
      // 500 pending (never decided), 300 active (approved), 200
      // shariah_rejected (excluded — no longer counts), 100 active
      // (approved). Committed = 500 + 300 + 100 = 900, so 4100 remains.
      // This new one stays deliberately undecided (pending_shariah_review)
      // to prove the ceiling counts a pending investment too, not just
      // active ones — 4100 more should fit exactly, one dollar past that
      // should not.
      const pending = await service.create(
        {
          waqfId: screeningWaqfId,
          name: "Ceiling Check Fixture Sukuk",
          instrumentType: "sukuk",
          allocatedAmount: "4100",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
        },
        actorUserId,
      );
      investmentIds.push(pending.id);
      expect(pending.status).toBe("pending_shariah_review");

      await expect(
        service.create(
          {
            waqfId: screeningWaqfId,
            name: "Should Exceed Raised",
            instrumentType: "sukuk",
            allocatedAmount: "1",
            counterpartyId: screeningCounterpartyId,
            businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
          },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // listForFounder() had no isolation test at all — a regression dropping
  // the foundationFounders ownership clause or the withFounderScope RLS
  // binding here would have gone undetected. Same convention as
  // AssetsService.listForFounder's own regression-coverage test.
  describe("listForFounder()", () => {
    test("returns the waqf's own investments for the founder that owns it", async () => {
      const result = await service.listForFounder(waqfId, founderId);
      expect(result).not.toBeNull();
      expect(result!.some((i) => investmentIds.includes(i.id))).toBe(true);
    });

    test("returns null for a founder who doesn't own the waqf (isolation)", async () => {
      const result = await service.listForFounder(waqfId, otherFounderId);
      expect(result).toBeNull();
    });
  });
});
