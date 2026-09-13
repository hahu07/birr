import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { VaultDistributionsService } from "./vault-distributions.service";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import { FakePaystackPayoutAdapter } from "../distributions/test-support/fake-payout-adapters";

describe("VaultDistributionsService", () => {
  const encryption = new EncryptionService();
  const fakePayoutAdapter = new FakePaystackPayoutAdapter();
  const service = new VaultDistributionsService(encryption, fakePayoutAdapter as any);
  const vaultsService = new VaultsService(new VaultProceedsService());

  const vaultIds: string[] = [];
  const vaultDistributionIds: string[] = [];
  const counterpartyIds: string[] = [];
  let actorUserId: string;
  let vaultId: string;
  let causeId: string;
  let payoutReadyCounterpartyId: string;
  let noPayoutDetailsCounterpartyId: string;

  function paystackReadyBankDetails() {
    return encryption.encrypt(
      JSON.stringify({ bankName: "Test Bank", accountNumber: "0123456789", accountName: "Test Relief Partner", bankCode: "058" }),
    );
  }

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `vault-distributions-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const vault = await vaultsService.create(
      { name: "Distributions Test Vault", slug: `distributions-test-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultId = vault.id;
    vaultIds.push(vault.id);
    const cause = await vaultsService.createCause({ vaultId, name: "Flood Relief" }, actorUserId);
    causeId = cause.id;
    // Allocate directly for test simplicity — allocation itself is
    // governed (vault.cause_allocate) and covered by
    // governed-actions.service.spec.ts; this fixture just needs a real
    // ceiling in place already.
    await prisma.vaultCause.update({ where: { id: causeId }, data: { allocatedAmount: "1000" } });

    const payoutReady = await prisma.counterparty.create({
      data: {
        name: `Vault Distributions Fixture Relief Partner ${randomUUID()}`,
        institutionType: "relief_partner",
        jurisdiction: "NG",
        status: "active",
        payoutProvider: "paystack",
        payoutBankDetailsEncrypted: paystackReadyBankDetails(),
      },
    });
    payoutReadyCounterpartyId = payoutReady.id;
    counterpartyIds.push(payoutReady.id);

    const noPayoutDetails = await prisma.counterparty.create({
      data: {
        name: `Vault Distributions Fixture No-Payout Partner ${randomUUID()}`,
        institutionType: "relief_partner",
        jurisdiction: "NG",
        status: "active",
      },
    });
    noPayoutDetailsCounterpartyId = noPayoutDetails.id;
    counterpartyIds.push(noPayoutDetails.id);
  });

  afterAll(async () => {
    await prisma.vaultDistribution.deleteMany({ where: { id: { in: vaultDistributionIds } } });
    await prisma.vaultCause.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: counterpartyIds } } });
    await prisma.$disconnect();
  });

  test("create() writes the distribution and a matching audit_logs record", async () => {
    const distribution = await service.create(
      { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "200", currency: "USD" },
      actorUserId,
    );
    vaultDistributionIds.push(distribution.id);
    expect(distribution.status).toBe("pending");

    const logs = await prisma.auditLog.findMany({ where: { entityId: distribution.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, vaultId, action: "vault_distribution.created" });
  });

  test("create() rejects an amount exceeding the cause's unused allocation", async () => {
    await expect(
      service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "999999", currency: "USD" },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("approve() rejects a counterparty with no payout bank details on file", async () => {
    const distribution = await service.create(
      { vaultId, vaultCauseId: causeId, counterpartyId: noPayoutDetailsCounterpartyId, amount: "50", currency: "USD" },
      actorUserId,
    );
    vaultDistributionIds.push(distribution.id);

    await prisma.$transaction(async (tx) => {
      await expect(service.approve(distribution.id, tx)).rejects.toThrow(BadRequestException);
    });
  });

  test("approve() succeeds for a payout-ready counterparty, and initiateDisbursement() fires a real payout", async () => {
    const distribution = await service.create(
      { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "100", currency: "USD" },
      actorUserId,
    );
    vaultDistributionIds.push(distribution.id);

    const approved = await prisma.$transaction((tx) => service.approve(distribution.id, tx));
    expect(approved.status).toBe("approved");

    await service.initiateDisbursement(distribution.id);
    const disbursed = await prisma.vaultDistribution.findUniqueOrThrow({ where: { id: distribution.id } });
    expect(disbursed.status).toBe("disbursing");
    expect(disbursed.payoutProvider).toBe("paystack");
    expect(fakePayoutAdapter.calls.some((c) => c.reference === distribution.id)).toBe(true);
  });

  test("handlePayoutWebhook() confirms a disbursing distribution as paid", async () => {
    const distribution = await service.create(
      { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "75", currency: "USD" },
      actorUserId,
    );
    vaultDistributionIds.push(distribution.id);
    await prisma.$transaction((tx) => service.approve(distribution.id, tx));
    await service.initiateDisbursement(distribution.id);

    const webhookBody = Buffer.from(JSON.stringify({ event: "transfer.success", data: { reference: distribution.id } }));
    const result = await service.handlePayoutWebhook(webhookBody, {});
    expect(result?.status).toBe("paid");
  });

  test("reject() moves a pending distribution to rejected", async () => {
    const distribution = await service.create(
      { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "25", currency: "USD" },
      actorUserId,
    );
    vaultDistributionIds.push(distribution.id);

    const rejected = await prisma.$transaction((tx) => service.reject(distribution.id, tx));
    expect(rejected.status).toBe("rejected");
  });

  test("create() throws NotFoundException for an unknown counterpartyId", async () => {
    await expect(
      service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: "00000000-0000-0000-0000-000000000000", amount: "10", currency: "USD" },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // Mirrors DistributionsService's own retryDisbursement coverage
  // exactly — see that spec's "payout rail" describe block. Same fixture
  // shape (a payout-ready counterparty, a real ceiling on the cause),
  // same fake-adapter shouldFail toggle to force a payout_failed row to
  // retry against.
  describe("retryDisbursement()", () => {
    beforeEach(() => {
      fakePayoutAdapter.calls = [];
      fakePayoutAdapter.shouldFail = false;
    });

    test("rejects a distribution that isn't payout_failed", async () => {
      const distribution = await service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "1", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
      await expect(service.retryDisbursement(distribution.id, actorUserId)).rejects.toThrow(BadRequestException);
    });

    test("re-checks headroom, resets status, clears payoutError, and re-attempts", async () => {
      fakePayoutAdapter.shouldFail = true;
      const distribution = await service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "1", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
      await prisma.$transaction((tx) => service.approve(distribution.id, tx));
      await service.initiateDisbursement(distribution.id);
      const failed = await prisma.vaultDistribution.findUniqueOrThrow({ where: { id: distribution.id } });
      expect(failed.status).toBe("payout_failed");

      fakePayoutAdapter.shouldFail = false;
      await service.retryDisbursement(distribution.id, actorUserId);

      const retried = await prisma.vaultDistribution.findUniqueOrThrow({ where: { id: distribution.id } });
      expect(retried.status).toBe("disbursing");
      expect(retried.payoutError).toBeNull();
    });

    test("rejects if headroom was consumed by another distribution in the meantime", async () => {
      const tightCause = await vaultsService.createCause({ vaultId, name: "Retry Headroom Fixture Cause" }, actorUserId);
      await prisma.vaultCause.update({ where: { id: tightCause.id }, data: { allocatedAmount: "10" } });

      fakePayoutAdapter.shouldFail = true;
      const distribution = await service.create(
        { vaultId, vaultCauseId: tightCause.id, counterpartyId: payoutReadyCounterpartyId, amount: "10", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
      await prisma.$transaction((tx) => service.approve(distribution.id, tx));
      await service.initiateDisbursement(distribution.id);
      const failed = await prisma.vaultDistribution.findUniqueOrThrow({ where: { id: distribution.id } });
      expect(failed.status).toBe("payout_failed");

      // Another distribution now consumes the cause's entire headroom
      // while the first sits payout_failed (deliberately excluded from
      // "committed" — see the shared allocation-ceiling module's own
      // comment).
      const other = await service.create(
        { vaultId, vaultCauseId: tightCause.id, counterpartyId: payoutReadyCounterpartyId, amount: "10", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(other.id);

      await expect(service.retryDisbursement(distribution.id, actorUserId)).rejects.toThrow(BadRequestException);
    });

    // Regression coverage for the double-payout race, mirroring
    // DistributionsService's own concurrent-retry test — proves the
    // atomic claim (updateMany with payout_failed in the WHERE clause)
    // holds under real concurrency, not just sequential idempotency.
    test("two concurrent retries of the same failed distribution: only one reaches the payout adapter", async () => {
      fakePayoutAdapter.shouldFail = true;
      const distribution = await service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "1", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
      await prisma.$transaction((tx) => service.approve(distribution.id, tx));
      await service.initiateDisbursement(distribution.id);
      const failed = await prisma.vaultDistribution.findUniqueOrThrow({ where: { id: distribution.id } });
      expect(failed.status).toBe("payout_failed");

      fakePayoutAdapter.shouldFail = false;
      fakePayoutAdapter.calls = [];
      const outcomes = await Promise.allSettled([
        service.retryDisbursement(distribution.id, actorUserId),
        service.retryDisbursement(distribution.id, actorUserId),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      expect(fakePayoutAdapter.calls).toHaveLength(1);
    });
  });
});
