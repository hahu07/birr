import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { DistributionsService } from "./distributions.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import { WaqfLedgerService } from "../waqf-ledger/waqf-ledger.service";
import { WaqfMilestonesService } from "../waqf-ledger/waqf-milestones.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import {
  FakePaystackPayoutAdapter,
  createFakeStripePayoutAdapter,
  createFakeStablecoinPayoutAdapter,
} from "./test-support/fake-payout-adapters";

describe("DistributionsService", () => {
  const encryption = new EncryptionService();
  const beneficiariesService = new BeneficiariesService(encryption);
  const fakePaystackPayoutAdapter = new FakePaystackPayoutAdapter();
  const service = new DistributionsService(
    beneficiariesService,
    createFakeNotificationsService(),
    new WaqfLedgerService(),
    createFakeStripePayoutAdapter() as any,
    fakePaystackPayoutAdapter as any,
    createFakeStablecoinPayoutAdapter() as any,
  );
  const milestonesService = new WaqfMilestonesService();

  // Every fixture beneficiary that ever goes through approve()/
  // initiateDisbursement needs complete Paystack payout details on file
  // now that approve() gates on assertPayoutReady — otherwise a test
  // meant to exercise headroom/eligibility re-checks would instead fail
  // on payout-readiness, testing the wrong thing.
  function paystackReadyBeneficiaryData() {
    return {
      payoutProvider: "paystack" as const,
      bankDetailsEncrypted: encryption.encrypt(
        JSON.stringify({ bankName: "Test Bank", accountNumber: "0123456789", accountName: "Test Beneficiary", bankCode: "058" }),
      ),
    };
  }

  const waqfIds: string[] = [];
  const beneficiaryIds: string[] = [];
  const waqfCauseIds: string[] = [];
  const distributionIds: string[] = [];

  let waqfAId: string;
  let waqfBId: string;
  let waqfInvestmentId: string;
  let beneficiaryId: string;
  let investmentBeneficiaryId: string;
  let causeOnWaqfAId: string;
  let causeOnWaqfBId: string;
  let waqfProjectId: string;
  let causeOnProjectWaqfId: string;
  let projectBeneficiaryId: string;
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `distributions-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const foundation = await prisma.foundation.create({
      data: { name: "Distributions Fixture Foundation" },
    });

    const waqfA = await prisma.waqf.create({
      data: { name: "Distributions Fixture Waqf A", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfAId = waqfA.id;
    waqfIds.push(waqfA.id);

    const waqfB = await prisma.waqf.create({
      data: { name: "Distributions Fixture Waqf B", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfBId = waqfB.id;
    waqfIds.push(waqfB.id);

    const waqfInvestment = await prisma.waqf.create({
      data: { name: "Distributions Fixture Waqf Investment", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfInvestmentId = waqfInvestment.id;
    waqfIds.push(waqfInvestment.id);

    const beneficiary = await prisma.beneficiary.create({
      data: { waqfId: waqfAId, name: "Distributions Fixture Beneficiary", eligibilityCriteria: "Fixture", ...paystackReadyBeneficiaryData() },
    });
    beneficiaryId = beneficiary.id;
    beneficiaryIds.push(beneficiary.id);

    const investmentBeneficiary = await prisma.beneficiary.create({
      data: {
        waqfId: waqfInvestmentId,
        name: "Distributions Fixture Investment Beneficiary",
        eligibilityCriteria: "Fixture",
        ...paystackReadyBeneficiaryData(),
      },
    });
    investmentBeneficiaryId = investmentBeneficiary.id;
    beneficiaryIds.push(investmentBeneficiary.id);

    const causeOnA = await prisma.waqfCause.create({
      data: { waqfId: waqfAId, name: "Cause On Waqf A", allocatedAmount: "150" },
    });
    causeOnWaqfAId = causeOnA.id;
    waqfCauseIds.push(causeOnA.id);

    const causeOnB = await prisma.waqfCause.create({
      data: { waqfId: waqfBId, name: "Cause On Waqf B" },
    });
    causeOnWaqfBId = causeOnB.id;
    waqfCauseIds.push(causeOnB.id);

    // Project-type waqf, for the milestone-gate tests below — milestones
    // only apply to project-type waqf funds (WaqfMilestonesService
    // .create()'s own gate), unlike waqfA above.
    const waqfProject = await prisma.waqf.create({
      data: { name: "Distributions Fixture Project Waqf", type: "project", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfProjectId = waqfProject.id;
    waqfIds.push(waqfProject.id);

    const causeOnProject = await prisma.waqfCause.create({
      data: { waqfId: waqfProjectId, name: "Cause On Project Waqf", allocatedAmount: "1000" },
    });
    causeOnProjectWaqfId = causeOnProject.id;
    waqfCauseIds.push(causeOnProject.id);

    const projectBeneficiary = await prisma.beneficiary.create({
      data: { waqfId: waqfProjectId, name: "Distributions Fixture Project Beneficiary", eligibilityCriteria: "Fixture", ...paystackReadyBeneficiaryData() },
    });
    projectBeneficiaryId = projectBeneficiary.id;
    beneficiaryIds.push(projectBeneficiary.id);
  });

  afterAll(async () => {
    await prisma.distribution.deleteMany({ where: { id: { in: distributionIds } } });
    await prisma.waqfJournalEntryLine.deleteMany({ where: { journalEntry: { waqfId: { in: waqfIds } } } });
    await prisma.waqfJournalEntry.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqfMilestone.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqfCause.deleteMany({ where: { id: { in: waqfCauseIds } } });
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("create() succeeds when causeId belongs to the same waqf", async () => {
    const distribution = await service.create(
      {
        waqfId: waqfAId,
        beneficiaryId,
        causeId: causeOnWaqfAId,
        amount: "100",
        currency: "USD",
      },
      actorUserId,
    );
    distributionIds.push(distribution.id);
    expect(distribution.causeId).toBe(causeOnWaqfAId);
  });

  test("create() rejects a causeId that belongs to a different waqf", async () => {
    await expect(
      service.create(
        {
          waqfId: waqfAId,
          beneficiaryId,
          causeId: causeOnWaqfBId,
          amount: "100",
          currency: "USD",
        },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // 2026-09-04 fix: a beneficiary nominated for one cause used to be
  // payable from any cause on the same waqf — nothing cross-checked
  // Beneficiary.causeId against the distribution's own causeId, even
  // though eligibilityCriteria is written for that specific cause's
  // purpose. beneficiaryId itself (used throughout this file) has no
  // causeId on file — the legacy/undeclared case, which stays
  // unchecked by design — so this exercises the actual new rule with a
  // beneficiary that does have one.
  test("create() rejects a distribution against a cause the beneficiary wasn't nominated for", async () => {
    // Dedicated causes, not the shared causeOnWaqfAId fixture — several
    // other tests in this file depend on that one's remaining headroom
    // staying predictable.
    const nominatedCause = await prisma.waqfCause.create({
      data: { waqfId: waqfAId, name: "Beneficiary Mismatch Fixture Cause (Nominated)", allocatedAmount: "500" },
    });
    waqfCauseIds.push(nominatedCause.id);
    const otherCause = await prisma.waqfCause.create({
      data: { waqfId: waqfAId, name: "Beneficiary Mismatch Fixture Cause (Other)", allocatedAmount: "500" },
    });
    waqfCauseIds.push(otherCause.id);

    const nominatedBeneficiary = await prisma.beneficiary.create({
      data: {
        waqfId: waqfAId,
        causeId: nominatedCause.id,
        name: "Cause-Nominated Fixture Beneficiary",
        eligibilityCriteria: "Vetted specifically for the nominated cause",
        ...paystackReadyBeneficiaryData(),
      },
    });
    beneficiaryIds.push(nominatedBeneficiary.id);

    await expect(
      service.create(
        { waqfId: waqfAId, beneficiaryId: nominatedBeneficiary.id, causeId: otherCause.id, amount: "10", currency: "USD" },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    // Exactly the cause they were nominated for still succeeds.
    const distribution = await service.create(
      { waqfId: waqfAId, beneficiaryId: nominatedBeneficiary.id, causeId: nominatedCause.id, amount: "10", currency: "USD" },
      actorUserId,
    );
    distributionIds.push(distribution.id);
  });

  test("create() writes a matching audit_logs record", async () => {
    const distribution = await service.create(
      {
        waqfId: waqfAId,
        beneficiaryId,
        causeId: causeOnWaqfAId,
        amount: "50",
        currency: "USD",
      },
      actorUserId,
    );
    distributionIds.push(distribution.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: distribution.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "Distribution",
      action: "distribution.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });

  describe("allocation enforcement", () => {
    let allocatedCauseId: string;

    beforeAll(async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Allocation Enforcement Cause", allocatedAmount: "100" },
      });
      allocatedCauseId = cause.id;
      waqfCauseIds.push(cause.id);
    });

    test("rejects a distribution with no allocation set on its cause", async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "No Allocation Cause" },
      });
      waqfCauseIds.push(cause.id);

      await expect(
        service.create(
          { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "1", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    test("rejects a distribution that would exceed the cause's remaining headroom", async () => {
      const first = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: allocatedCauseId, amount: "60", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(first.id);

      // 60 already committed, only 40 left of the 100 allocation.
      await expect(
        service.create(
          { waqfId: waqfAId, beneficiaryId, causeId: allocatedCauseId, amount: "41", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      // Exactly the remaining headroom still succeeds.
      const second = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: allocatedCauseId, amount: "40", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(second.id);
    });

    test("locks a cause to its first committed currency — rejects a second currency, and confirms the ceiling can't be bypassed by mixing currencies (2026-08-30 security audit fix)", async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Currency Lock Cause", allocatedAmount: "100" },
      });
      waqfCauseIds.push(cause.id);

      // 90 NGN committed — well within the 100 ceiling.
      const ngnDistribution = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "90", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(ngnDistribution.id);

      // Before the fix, a second currency's own committed sum was
      // compared against the ceiling with NO awareness of the 90 NGN
      // already committed — a 15 USD distribution would have been
      // accepted purely because 15 < 100, even though nothing about a
      // shared numeric ceiling makes 90 NGN + 15 USD any kind of
      // meaningful total. Now it's rejected outright: the cause is
      // locked to NGN once NGN has committed.
      await expect(
        service.create(
          { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "15", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      // A same-currency (NGN) distribution within the remaining headroom
      // still works exactly as before.
      const secondNgn = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "10", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(secondNgn.id);
    });

    test("approve() re-checks headroom and rejects if it shrank since creation", async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Approve Recheck Cause", allocatedAmount: "100" },
      });
      waqfCauseIds.push(cause.id);

      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "80", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(pending.id);

      // Headroom shrinks: lower the cause's allocation after the
      // distribution was already created against the old, larger figure.
      await prisma.waqfCause.update({ where: { id: cause.id }, data: { allocatedAmount: "50" } });

      await prisma.$transaction(async (tx) => {
        await expect(service.approve(pending.id, tx)).rejects.toThrow(BadRequestException);
      });
    });

    test("concurrent create() calls against the same cause can't jointly exceed the ceiling (TOCTOU regression)", async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Concurrency Fixture Cause", allocatedAmount: "100" },
      });
      waqfCauseIds.push(cause.id);

      // Each individually fits under the 100 ceiling (60 < 100), but
      // together they total 120 — exceeding it. Without the row lock in
      // assertWithinAllocation, both transactions could read "0 already
      // committed" before either commits, and both would succeed.
      const results = await Promise.allSettled([
        service.create({ waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "60", currency: "USD" }, actorUserId),
        service.create({ waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "60", currency: "USD" }, actorUserId),
      ]);

      const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof service.create>>> => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      distributionIds.push(fulfilled[0].value.id);

      const committed = await prisma.distribution.aggregate({
        where: { causeId: cause.id, status: { in: ["pending", "approved", "disbursing", "paid"] } },
        _sum: { amount: true },
      });
      expect(committed._sum.amount?.toString()).toBe("60");
    });

    // waqfAId is type "asset" — no proceeds concept exists for it in
    // the real product (WaqfProceedsService only accepts Investment-type
    // waqfs), but nothing stops a test fixture from setting
    // proceedsAllocatedAmount directly, which is exactly what this
    // exercises: for a non-Investment waqf, both pools still combine
    // into one ceiling (see the Investment-only tests below for the
    // 2026-09-04 reversal this test used to — incorrectly — claim to
    // cover, back when assertWithinAllocation didn't branch on waqf type
    // at all).
    test("non-Investment waqf: ceiling is the sum of allocatedAmount and proceedsAllocatedAmount", async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Two Pools Cause", allocatedAmount: "60", proceedsAllocatedAmount: "40" },
      });
      waqfCauseIds.push(cause.id);

      // 60 + 40 = 100 combined ceiling — exceeding it by 1 rejects.
      await expect(
        service.create(
          { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "101", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      // Exactly the combined total succeeds.
      const distribution = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "100", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(distribution.id);
    });

    // The 2026-09-04 reversal (see CLAUDE.md's own record): corpus is
    // preserved principal for an Investment-type waqf, not itself
    // distributable — only proceedsAllocatedAmount is a real ceiling
    // there, regardless of how much corpus (allocatedAmount) is set.
    test("Investment waqf: only proceedsAllocatedAmount counts toward the ceiling — corpus is excluded", async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfInvestmentId, name: "Investment Cause", allocatedAmount: "1000", proceedsAllocatedAmount: "40" },
      });
      waqfCauseIds.push(cause.id);

      // Corpus (1000) is NOT part of the ceiling here — only proceeds
      // (40) is, so even a modest 41 against a cause with 1000 of
      // corpus allocated still rejects.
      await expect(
        service.create(
          { waqfId: waqfInvestmentId, beneficiaryId: investmentBeneficiaryId, causeId: cause.id, amount: "41", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      // Exactly the proceeds total succeeds, ignoring the much larger corpus figure.
      const distribution = await service.create(
        { waqfId: waqfInvestmentId, beneficiaryId: investmentBeneficiaryId, causeId: cause.id, amount: "40", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(distribution.id);
    });
  });

  describe("beneficiary eligibility", () => {
    let eligibilityCauseId: string;

    beforeAll(async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Eligibility Fixture Cause", allocatedAmount: "1000" },
      });
      eligibilityCauseId = cause.id;
      waqfCauseIds.push(cause.id);
    });

    test("rejects a distribution against an inactive beneficiary", async () => {
      const inactive = await prisma.beneficiary.create({
        data: { waqfId: waqfAId, name: "Inactive Fixture Beneficiary", eligibilityCriteria: "Fixture", status: "inactive" },
      });
      beneficiaryIds.push(inactive.id);

      await expect(
        service.create(
          { waqfId: waqfAId, beneficiaryId: inactive.id, causeId: eligibilityCauseId, amount: "1", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    test("rejects a distribution against a beneficiary whose eligibility has expired", async () => {
      const expired = await prisma.beneficiary.create({
        data: {
          waqfId: waqfAId,
          name: "Expired Fixture Beneficiary",
          eligibilityCriteria: "Fixture",
          eligibilityExpiresAt: new Date("2020-01-01"),
        },
      });
      beneficiaryIds.push(expired.id);

      await expect(
        service.create(
          { waqfId: waqfAId, beneficiaryId: expired.id, causeId: eligibilityCauseId, amount: "1", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    test("succeeds against a beneficiary with a future expiry date or no expiry at all", async () => {
      const futureExpiry = await prisma.beneficiary.create({
        data: {
          waqfId: waqfAId,
          name: "Future Expiry Fixture Beneficiary",
          eligibilityCriteria: "Fixture",
          eligibilityExpiresAt: new Date("2099-01-01"),
        },
      });
      beneficiaryIds.push(futureExpiry.id);

      const distribution = await service.create(
        { waqfId: waqfAId, beneficiaryId: futureExpiry.id, causeId: eligibilityCauseId, amount: "1", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(distribution.id);
      expect(distribution.status).toBe("pending");
    });

    test("approve() re-checks eligibility and rejects if status changed to inactive since creation", async () => {
      const beneficiary = await prisma.beneficiary.create({
        data: { waqfId: waqfAId, name: "Approve Recheck Eligibility Beneficiary", eligibilityCriteria: "Fixture", ...paystackReadyBeneficiaryData() },
      });
      beneficiaryIds.push(beneficiary.id);

      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId: beneficiary.id, causeId: eligibilityCauseId, amount: "1", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(pending.id);

      await prisma.beneficiary.update({ where: { id: beneficiary.id }, data: { status: "inactive" } });

      await prisma.$transaction(async (tx) => {
        await expect(service.approve(pending.id, tx)).rejects.toThrow(BadRequestException);
      });
    });
  });

  describe("payout rail", () => {
    let payoutCauseId: string;

    beforeAll(async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Payout Rail Fixture Cause", allocatedAmount: "1000" },
      });
      payoutCauseId = cause.id;
      waqfCauseIds.push(cause.id);
    });

    beforeEach(() => {
      fakePaystackPayoutAdapter.calls = [];
      fakePaystackPayoutAdapter.shouldFail = false;
    });

    test("approve() blocks and does not change status when the beneficiary has no payoutProvider set", async () => {
      const beneficiary = await prisma.beneficiary.create({
        data: { waqfId: waqfAId, name: "No Payout Provider Beneficiary", eligibilityCriteria: "Fixture" },
      });
      beneficiaryIds.push(beneficiary.id);
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId: beneficiary.id, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);

      await prisma.$transaction(async (tx) => {
        await expect(service.approve(pending.id, tx)).rejects.toThrow(BadRequestException);
      });
      const unchanged = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(unchanged!.status).toBe("pending");
    });

    test("approve() blocks when payoutProvider is set but bank details are missing", async () => {
      const beneficiary = await prisma.beneficiary.create({
        data: { waqfId: waqfAId, name: "No Bank Details Beneficiary", eligibilityCriteria: "Fixture", payoutProvider: "paystack" },
      });
      beneficiaryIds.push(beneficiary.id);
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId: beneficiary.id, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);

      await prisma.$transaction(async (tx) => {
        await expect(service.approve(pending.id, tx)).rejects.toThrow(BadRequestException);
      });
    });

    test("approve() blocks when bank details exist but are missing a bank code", async () => {
      const beneficiary = await prisma.beneficiary.create({
        data: {
          waqfId: waqfAId,
          name: "No Bank Code Beneficiary",
          eligibilityCriteria: "Fixture",
          payoutProvider: "paystack",
          bankDetailsEncrypted: encryption.encrypt(
            JSON.stringify({ bankName: "Test Bank", accountNumber: "0123456789", accountName: "Test Beneficiary" }),
          ),
        },
      });
      beneficiaryIds.push(beneficiary.id);
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId: beneficiary.id, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);

      await prisma.$transaction(async (tx) => {
        await expect(service.approve(pending.id, tx)).rejects.toThrow(BadRequestException);
      });
    });

    test("approve() succeeds when Paystack payout details are complete", async () => {
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);

      const approved = await prisma.$transaction((tx) => service.approve(pending.id, tx));
      expect(approved.status).toBe("approved");
    });

    test("initiateDisbursement() moves an approved distribution to disbursing and records the payout reference", async () => {
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));

      await service.initiateDisbursement(pending.id);

      const updated = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(updated!.status).toBe("disbursing");
      expect(updated!.payoutProvider).toBe("paystack");
      expect(updated!.payoutReference).toBe(pending.id);
      expect(fakePaystackPayoutAdapter.calls).toHaveLength(1);
    });

    test("initiateDisbursement() records payout_failed and an error message when the adapter throws", async () => {
      fakePaystackPayoutAdapter.shouldFail = true;
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));

      await service.initiateDisbursement(pending.id);

      const updated = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(updated!.status).toBe("payout_failed");
      expect(updated!.payoutError).toContain("Simulated Paystack transfer failure");
    });

    test("initiateDisbursement() is idempotent — a second call on an already-disbursing row is a no-op", async () => {
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));
      await service.initiateDisbursement(pending.id);
      expect(fakePaystackPayoutAdapter.calls).toHaveLength(1);

      await service.initiateDisbursement(pending.id);
      expect(fakePaystackPayoutAdapter.calls).toHaveLength(1); // unchanged — status is no longer "approved"
    });

    test("retryDisbursement() rejects a distribution that isn't payout_failed", async () => {
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await expect(service.retryDisbursement(pending.id, actorUserId)).rejects.toThrow(BadRequestException);
    });

    test("retryDisbursement() re-checks headroom, resets status, clears payoutError, and re-attempts", async () => {
      fakePaystackPayoutAdapter.shouldFail = true;
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));
      await service.initiateDisbursement(pending.id);
      const failed = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(failed!.status).toBe("payout_failed");

      fakePaystackPayoutAdapter.shouldFail = false;
      await service.retryDisbursement(pending.id, actorUserId);

      const retried = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(retried!.status).toBe("disbursing");
      expect(retried!.payoutError).toBeNull();
    });

    test("retryDisbursement() rejects if headroom was consumed by another distribution in the meantime", async () => {
      const tightCause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Retry Headroom Fixture Cause", allocatedAmount: "10" },
      });
      waqfCauseIds.push(tightCause.id);

      fakePaystackPayoutAdapter.shouldFail = true;
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: tightCause.id, amount: "10", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));
      await service.initiateDisbursement(pending.id);
      const failed = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(failed!.status).toBe("payout_failed");

      // Another distribution now consumes the cause's entire headroom
      // while the first sits payout_failed (deliberately excluded from
      // "committed" — see assertWithinAllocation's own comment).
      const other = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: tightCause.id, amount: "10", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(other.id);

      await expect(service.retryDisbursement(pending.id, actorUserId)).rejects.toThrow(BadRequestException);
    });

    // Regression tests for the double-payout race: each of the three
    // methods below used to read status via a plain check and then write
    // it unconditionally, so two genuinely concurrent callers could both
    // pass the check and both proceed — for initiateDisbursement(), that
    // meant two real Paystack payouts for one distribution. The fix is an
    // atomic claim (updateMany with the expected current status in the
    // WHERE clause); these prove it holds under real concurrency, not
    // just the sequential idempotency the tests above already covered.

    test("approve() — two concurrent approvals of the same pending distribution: only one succeeds", async () => {
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);

      const outcomes = await Promise.allSettled([
        prisma.$transaction((tx) => service.approve(pending.id, tx)),
        prisma.$transaction((tx) => service.approve(pending.id, tx)),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);

      const finalDistribution = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(finalDistribution!.status).toBe("approved");
    });

    test("initiateDisbursement() — two concurrent calls on the same approved distribution: only one reaches the payout adapter", async () => {
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));

      await Promise.all([service.initiateDisbursement(pending.id), service.initiateDisbursement(pending.id)]);

      // This is the assertion that actually proves the double-payout fix
      // — a sequential-only test can't distinguish "idempotent" from
      // "never raced in the first place".
      expect(fakePaystackPayoutAdapter.calls).toHaveLength(1);

      const updated = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(updated!.status).toBe("disbursing");
    });

    test("retryDisbursement() — two concurrent retries of the same failed distribution: only one reaches the payout adapter", async () => {
      fakePaystackPayoutAdapter.shouldFail = true;
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));
      await service.initiateDisbursement(pending.id);
      const failed = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(failed!.status).toBe("payout_failed");

      fakePaystackPayoutAdapter.shouldFail = false;
      fakePaystackPayoutAdapter.calls = [];
      const outcomes = await Promise.allSettled([
        service.retryDisbursement(pending.id, actorUserId),
        service.retryDisbursement(pending.id, actorUserId),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      expect(fakePaystackPayoutAdapter.calls).toHaveLength(1);
    });

    test("handlePayoutWebhook() flips disbursing -> paid on transfer.success and is idempotent on replay", async () => {
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));
      await service.initiateDisbursement(pending.id);

      const rawBody = Buffer.from(JSON.stringify({ event: "transfer.success", data: { reference: pending.id } }));
      const result = await service.handlePayoutWebhook(rawBody, {});
      expect(result!.status).toBe("paid");
      expect(result!.paidAt).not.toBeNull();

      // Replay — idempotent no-op, not a second state change.
      const replay = await service.handlePayoutWebhook(rawBody, {});
      expect(replay!.status).toBe("paid");

      // Double-entry auto-post (2026-09-15, ported from
      // VaultDistributionsService.handlePayoutWebhook's own hook) —
      // Debit Program Expenses, Credit Cash & Bank.
      const journalEntry = await prisma.waqfJournalEntry.findFirst({
        where: { source: "distribution", sourceId: pending.id },
        include: { lines: { include: { ledgerAccount: true } } },
      });
      expect(journalEntry?.lines).toHaveLength(2);
      expect(journalEntry?.lines.find((l) => l.ledgerAccount.code === "5000")?.debit.toString()).toBe("1");
      expect(journalEntry?.lines.find((l) => l.ledgerAccount.code === "1000")?.credit.toString()).toBe("1");
    });

    test("two concurrent deliveries of the same 'paid' webhook post the ledger exactly once", async () => {
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));
      await service.initiateDisbursement(pending.id);

      const rawBody = Buffer.from(JSON.stringify({ event: "transfer.success", data: { reference: pending.id } }));
      const outcomes = await Promise.all([service.handlePayoutWebhook(rawBody, {}), service.handlePayoutWebhook(rawBody, {})]);
      expect(outcomes.every((o) => o?.status === "paid")).toBe(true);

      expect(await prisma.waqfJournalEntry.count({ where: { source: "distribution", sourceId: pending.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: pending.id, action: "distribution.paid" } })).toBe(1);
    });

    test("handlePayoutWebhook() flips disbursing -> payout_failed on transfer.failed", async () => {
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: payoutCauseId, amount: "1", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));
      await service.initiateDisbursement(pending.id);

      const rawBody = Buffer.from(JSON.stringify({ event: "transfer.failed", data: { reference: pending.id } }));
      const result = await service.handlePayoutWebhook(rawBody, {});
      expect(result!.status).toBe("payout_failed");
      expect(result!.payoutError).not.toBeNull();
    });

    test("handlePayoutWebhook() returns null for an event it doesn't recognize, so the caller can fall through", async () => {
      const rawBody = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "irrelevant" } }));
      const result = await service.handlePayoutWebhook(rawBody, {});
      expect(result).toBeNull();
    });

    test("assertWithinAllocation (via create()) excludes payout_failed distributions from the committed sum", async () => {
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Payout Failed Exclusion Cause", allocatedAmount: "10" },
      });
      waqfCauseIds.push(cause.id);

      fakePaystackPayoutAdapter.shouldFail = true;
      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "10", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));
      await service.initiateDisbursement(pending.id);
      const failed = await prisma.distribution.findUnique({ where: { id: pending.id } });
      expect(failed!.status).toBe("payout_failed");

      // Full 10 headroom is available again — a payout_failed row never
      // actually moved money.
      const another = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "10", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(another.id);
    });
  });

  // The milestone gate (2026-09-15, ported from
  // VaultDistributionsService.create()'s own gate) — create() itself
  // refuses to build this distribution as a milestone's tranche until
  // that milestone's own status is "completed" (only reachable via the
  // governed waqf.milestone_complete action — see governed-actions
  // .service.ts).
  describe("milestone-gated tranche disbursement", () => {
    test("create() rejects a distribution against a milestone that isn't completed yet", async () => {
      const milestone = await milestonesService.create({ waqfId: waqfProjectId, name: "Not yet done", sequence: 101 }, actorUserId);
      await expect(
        service.create(
          { waqfId: waqfProjectId, causeId: causeOnProjectWaqfId, beneficiaryId: projectBeneficiaryId, waqfMilestoneId: milestone.id, amount: "1", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    test("create() succeeds once the milestone is completed", async () => {
      const milestone = await milestonesService.create({ waqfId: waqfProjectId, name: "Actually done", sequence: 102 }, actorUserId);
      await prisma.$transaction((tx) => milestonesService.complete(milestone.id, tx));

      const distribution = await service.create(
        { waqfId: waqfProjectId, causeId: causeOnProjectWaqfId, beneficiaryId: projectBeneficiaryId, waqfMilestoneId: milestone.id, amount: "1", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(distribution.id);
      expect(distribution.waqfMilestoneId).toBe(milestone.id);
    });

    // Defense-in-depth: no un-complete path exists today, but approve()
    // re-checks the milestone's status independently of create()'s own
    // check, same reasoning as the headroom re-check in "allocation
    // enforcement" above.
    test("approve() re-checks the milestone independently and rejects if it's no longer completed", async () => {
      const milestone = await milestonesService.create({ waqfId: waqfProjectId, name: "Completed then reverted", sequence: 103 }, actorUserId);
      await prisma.$transaction((tx) => milestonesService.complete(milestone.id, tx));

      const distribution = await service.create(
        { waqfId: waqfProjectId, causeId: causeOnProjectWaqfId, beneficiaryId: projectBeneficiaryId, waqfMilestoneId: milestone.id, amount: "1", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(distribution.id);

      await prisma.waqfMilestone.update({ where: { id: milestone.id }, data: { status: "pending", completedAt: null } });

      await prisma.$transaction(async (tx) => {
        await expect(service.approve(distribution.id, tx)).rejects.toThrow(BadRequestException);
      });
    });

    test("create() rejects a milestone that belongs to a different waqf", async () => {
      const otherProjectWaqf = await prisma.waqf.create({
        data: { name: "Milestone Gate Other Project Waqf", type: "project", jurisdiction: "AE", foundationId: (await prisma.waqf.findUniqueOrThrow({ where: { id: waqfProjectId } })).foundationId },
      });
      waqfIds.push(otherProjectWaqf.id);
      const foreignMilestone = await milestonesService.create({ waqfId: otherProjectWaqf.id, name: "Wrong waqf", sequence: 1 }, actorUserId);
      await prisma.$transaction((tx) => milestonesService.complete(foreignMilestone.id, tx));

      await expect(
        service.create(
          { waqfId: waqfProjectId, causeId: causeOnProjectWaqfId, beneficiaryId: projectBeneficiaryId, waqfMilestoneId: foreignMilestone.id, amount: "1", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    test("create() succeeds with no milestone at all — an ad-hoc, non-tranche distribution behaves exactly as before this feature", async () => {
      const distribution = await service.create(
        { waqfId: waqfProjectId, causeId: causeOnProjectWaqfId, beneficiaryId: projectBeneficiaryId, amount: "1", currency: "USD" },
        actorUserId,
      );
      distributionIds.push(distribution.id);
      expect(distribution.waqfMilestoneId).toBeNull();
    });
  });

  describe("summaryByCause()", () => {
    test("includeBeneficiaryNames attaches distinct beneficiary names to a cause's paid total; omitted by default", async () => {
      // This describe block is a sibling of "payout rail" above, not
      // nested inside it, so that block's own beforeEach (which resets
      // this flag) doesn't apply here — reset explicitly.
      fakePaystackPayoutAdapter.shouldFail = false;
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Summary Fixture Cause", allocatedAmount: "1000" },
      });
      waqfCauseIds.push(cause.id);

      const pending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "10", currency: "NGN" },
        actorUserId,
      );
      distributionIds.push(pending.id);
      await prisma.$transaction((tx) => service.approve(pending.id, tx));
      await service.initiateDisbursement(pending.id);

      const rawBody = Buffer.from(JSON.stringify({ event: "transfer.success", data: { reference: pending.id } }));
      await service.handlePayoutWebhook(rawBody, {});

      const defaultSummary = await service.summaryByCause(waqfAId);
      const defaultRow = defaultSummary.find((s) => s.causeId === cause.id)!;
      expect((defaultRow as any).beneficiaryNames).toBeUndefined();

      const withNames = await service.summaryByCause(waqfAId, undefined, true);
      const rowWithNames = withNames.find((s) => s.causeId === cause.id)! as any;
      expect(rowWithNames.beneficiaryNames).toEqual(["Distributions Fixture Beneficiary"]);
      expect(rowWithNames.totalAmount.toString()).toBe("10");
    });
  });

  describe("platformSummary()", () => {
    test("sums paid distributions by currency, across every waqf, excluding pending/approved/disbursing/payout_failed", async () => {
      // A distinctive per-run currency code, not a real one — this is a
      // shared dev DB with plenty of pre-existing paid distributions in
      // real currencies from other tests/fixtures, so asserting an
      // exact platform-wide total only holds for a currency nothing
      // else could have touched.
      const currency = `T${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const cause = await prisma.waqfCause.create({
        data: { waqfId: waqfAId, name: "Platform Summary Fixture Cause", allocatedAmount: "1000" },
      });
      waqfCauseIds.push(cause.id);

      const paid = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "10", currency },
        actorUserId,
      );
      distributionIds.push(paid.id);
      await prisma.$transaction((tx) => service.approve(paid.id, tx));
      await service.initiateDisbursement(paid.id);
      await service.handlePayoutWebhook(
        Buffer.from(JSON.stringify({ event: "transfer.success", data: { reference: paid.id } })),
        {},
      );

      // Still pending — never counts as "paid".
      const stillPending = await service.create(
        { waqfId: waqfAId, beneficiaryId, causeId: cause.id, amount: "5", currency },
        actorUserId,
      );
      distributionIds.push(stillPending.id);

      const summary = await service.platformSummary();
      const row = summary.find((s) => s.currency === currency);
      expect(row?.totalAmount.toString()).toBe("10");
    });
  });
});
