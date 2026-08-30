import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { DistributionsService } from "./distributions.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { EncryptionService } from "../../common/settings/encryption.service";
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
    createFakeStripePayoutAdapter() as any,
    fakePaystackPayoutAdapter as any,
    createFakeStablecoinPayoutAdapter() as any,
  );

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
  let beneficiaryId: string;
  let causeOnWaqfAId: string;
  let causeOnWaqfBId: string;
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

    const beneficiary = await prisma.beneficiary.create({
      data: { waqfId: waqfAId, name: "Distributions Fixture Beneficiary", eligibilityCriteria: "Fixture", ...paystackReadyBeneficiaryData() },
    });
    beneficiaryId = beneficiary.id;
    beneficiaryIds.push(beneficiary.id);

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
  });

  afterAll(async () => {
    await prisma.distribution.deleteMany({ where: { id: { in: distributionIds } } });
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

    test("ceiling is the sum of allocatedAmount (corpus) and proceedsAllocatedAmount (investment proceeds)", async () => {
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
