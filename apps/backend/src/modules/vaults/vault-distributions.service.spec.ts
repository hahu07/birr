import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { VaultDistributionsService } from "./vault-distributions.service";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";
import { VaultLedgerService } from "./vault-ledger.service";
import { VaultMilestonesService } from "./vault-milestones.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import { FakePaystackPayoutAdapter } from "../distributions/test-support/fake-payout-adapters";

describe("VaultDistributionsService", () => {
  const encryption = new EncryptionService();
  const fakePayoutAdapter = new FakePaystackPayoutAdapter();
  const ledger = new VaultLedgerService();
  const service = new VaultDistributionsService(encryption, ledger, fakePayoutAdapter as any);
  const vaultsService = new VaultsService(new VaultProceedsService(), ledger);
  const milestonesService = new VaultMilestonesService();

  const vaultIds: string[] = [];
  const vaultDistributionIds: string[] = [];
  const counterpartyIds: string[] = [];
  let actorUserId: string;
  let vaultId: string;
  let causeId: string;
  let investmentVaultId: string;
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

    const investmentVault = await vaultsService.create(
      { name: "Distributions Test Investment Vault", slug: `distributions-investment-test-${Date.now()}`, type: "investment", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    investmentVaultId = investmentVault.id;
    vaultIds.push(investmentVault.id);

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
    // Journal entry lines before their entries before the vault itself
    // — the paid-distribution auto-post hook (2026-09-13) means these
    // fixture vaults now have VaultJournalEntry rows referencing them,
    // with no onDelete: Cascade on that FK.
    await prisma.vaultJournalEntryLine.deleteMany({ where: { journalEntry: { vaultId: { in: vaultIds } } } });
    await prisma.vaultJournalEntry.deleteMany({ where: { vaultId: { in: vaultIds } } });
    // Milestones after every distribution that could reference one
    // (already deleted above) — see the "milestone-gated tranche
    // disbursement" describe block (2026-09-13).
    await prisma.vaultMilestone.deleteMany({ where: { vaultId: { in: vaultIds } } });
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

    // Double-entry auto-post (2026-09-13) — a "paid" outcome should
    // post a balanced Program Expenses debit / Cash & Bank credit
    // journal entry, same amount as the distribution itself.
    const journalEntry = await prisma.vaultJournalEntry.findFirst({
      where: { source: "distribution", sourceId: distribution.id },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(journalEntry?.lines).toHaveLength(2);
    expect(journalEntry?.lines.find((l) => l.ledgerAccount.code === "5000")?.debit.toString()).toBe("75");
    expect(journalEntry?.lines.find((l) => l.ledgerAccount.code === "1000")?.credit.toString()).toBe("75");
  });

  test("handlePayoutWebhook() posts no journal entry on a failed payout outcome", async () => {
    const distribution = await service.create(
      { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "40", currency: "USD" },
      actorUserId,
    );
    vaultDistributionIds.push(distribution.id);
    await prisma.$transaction((tx) => service.approve(distribution.id, tx));
    await service.initiateDisbursement(distribution.id);

    const webhookBody = Buffer.from(JSON.stringify({ event: "transfer.failed", data: { reference: distribution.id } }));
    const result = await service.handlePayoutWebhook(webhookBody, {});
    expect(result?.status).toBe("payout_failed");

    const journalEntry = await prisma.vaultJournalEntry.findFirst({ where: { source: "distribution", sourceId: distribution.id } });
    expect(journalEntry).toBeNull();
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

  // Mirrors DistributionsService's own "allocation enforcement" describe
  // block, against the shared common/money/allocation-ceiling helper
  // both services now delegate to (see that module's own spec for the
  // policy's pure-logic unit tests — race-safety, corpus-vs-proceeds,
  // multi-currency lock-in). These are the integration-level tests
  // proving the wiring into VaultCause/VaultDistribution actually works.
  //
  // One test from the Waqf side is deliberately NOT ported here: the
  // multi-currency lock-in test. Distribution's own currency-lock only
  // applies "if waqf.corpusCurrency is set" (many waqf fixtures leave it
  // unset), so a Waqf-side distribution can genuinely reach
  // assertWithinAllocation with two different currencies against one
  // cause. VaultDistributionsService.create() has no such escape hatch
  // — vault.currency is a required field, always set, and every
  // VaultDistribution is rejected outright at create() if its currency
  // doesn't match the vault's own. A second currency can therefore never
  // reach assertWithinAllocation for a real Vault at all; that branch of
  // the shared helper is exercised only by its own unit test.
  describe("allocation enforcement", () => {
    test("rejects a distribution with no allocation set on its cause", async () => {
      const cause = await vaultsService.createCause({ vaultId, name: "No Allocation Fixture Cause" }, actorUserId);
      await expect(
        service.create(
          { vaultId, vaultCauseId: cause.id, counterpartyId: payoutReadyCounterpartyId, amount: "1", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    test("approve() re-checks headroom and rejects if it shrank since creation", async () => {
      const cause = await vaultsService.createCause({ vaultId, name: "Approve Recheck Fixture Cause" }, actorUserId);
      await prisma.vaultCause.update({ where: { id: cause.id }, data: { allocatedAmount: "100" } });

      const pending = await service.create(
        { vaultId, vaultCauseId: cause.id, counterpartyId: payoutReadyCounterpartyId, amount: "80", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(pending.id);

      // Headroom shrinks after the distribution was created against the
      // old, larger figure.
      await prisma.vaultCause.update({ where: { id: cause.id }, data: { allocatedAmount: "50" } });

      await prisma.$transaction(async (tx) => {
        await expect(service.approve(pending.id, tx)).rejects.toThrow(BadRequestException);
      });
    });

    test("concurrent create() calls against the same cause can't jointly exceed the ceiling (TOCTOU regression)", async () => {
      const cause = await vaultsService.createCause({ vaultId, name: "Concurrency Fixture Cause" }, actorUserId);
      await prisma.vaultCause.update({ where: { id: cause.id }, data: { allocatedAmount: "100" } });

      // Each individually fits under the 100 ceiling (60 < 100), but
      // together they total 120 — exceeding it. Without the shared
      // helper's row lock, both transactions could read "0 already
      // committed" before either commits, and both would succeed.
      const results = await Promise.allSettled([
        service.create({ vaultId, vaultCauseId: cause.id, counterpartyId: payoutReadyCounterpartyId, amount: "60", currency: "USD" }, actorUserId),
        service.create({ vaultId, vaultCauseId: cause.id, counterpartyId: payoutReadyCounterpartyId, amount: "60", currency: "USD" }, actorUserId),
      ]);

      const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof service.create>>> => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      vaultDistributionIds.push(fulfilled[0].value.id);

      const committed = await prisma.vaultDistribution.aggregate({
        where: { vaultCauseId: cause.id, status: { in: ["pending", "approved", "disbursing", "paid"] } },
        _sum: { amount: true },
      });
      expect(committed._sum.amount?.toString()).toBe("60");
    });

    test("non-Investment vault: ceiling is the sum of allocatedAmount and proceedsAllocatedAmount", async () => {
      const cause = await vaultsService.createCause({ vaultId, name: "Two Pools Fixture Cause" }, actorUserId);
      await prisma.vaultCause.update({ where: { id: cause.id }, data: { allocatedAmount: "60", proceedsAllocatedAmount: "40" } });

      // 60 + 40 = 100 combined ceiling — exceeding it by 1 rejects.
      await expect(
        service.create(
          { vaultId, vaultCauseId: cause.id, counterpartyId: payoutReadyCounterpartyId, amount: "101", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      // Exactly the combined total succeeds.
      const distribution = await service.create(
        { vaultId, vaultCauseId: cause.id, counterpartyId: payoutReadyCounterpartyId, amount: "100", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
    });

    test("Investment vault: only proceedsAllocatedAmount counts toward the ceiling — corpus is excluded", async () => {
      const cause = await vaultsService.createCause({ vaultId: investmentVaultId, name: "Investment Fixture Cause" }, actorUserId);
      await prisma.vaultCause.update({ where: { id: cause.id }, data: { allocatedAmount: "1000", proceedsAllocatedAmount: "40" } });

      // Corpus (1000) is NOT part of the ceiling here — only proceeds
      // (40) is, so even a modest 41 against a cause with 1000 of corpus
      // allocated still rejects.
      await expect(
        service.create(
          { vaultId: investmentVaultId, vaultCauseId: cause.id, counterpartyId: payoutReadyCounterpartyId, amount: "41", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      // Exactly the proceeds total succeeds, ignoring the much larger corpus figure.
      const distribution = await service.create(
        { vaultId: investmentVaultId, vaultCauseId: cause.id, counterpartyId: payoutReadyCounterpartyId, amount: "40", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
    });
  });

  // Mirrors DistributionsService's own payout-rail idempotency/
  // concurrency coverage — proves the atomic claim (updateMany with the
  // expected current status in the WHERE clause) holds for Vault's own
  // initiateDisbursement/handlePayoutWebhook, not just retryDisbursement
  // (already covered below).
  describe("payout idempotency and concurrency", () => {
    beforeEach(() => {
      fakePayoutAdapter.calls = [];
      fakePayoutAdapter.shouldFail = false;
    });

    test("initiateDisbursement() is idempotent — a second call on an already-disbursing row is a no-op", async () => {
      const distribution = await service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "1", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
      await prisma.$transaction((tx) => service.approve(distribution.id, tx));
      await service.initiateDisbursement(distribution.id);
      expect(fakePayoutAdapter.calls).toHaveLength(1);

      await service.initiateDisbursement(distribution.id);
      expect(fakePayoutAdapter.calls).toHaveLength(1); // unchanged — status is no longer "approved"
    });

    test("initiateDisbursement() — two concurrent calls on the same approved distribution: only one reaches the payout adapter", async () => {
      const distribution = await service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "1", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
      await prisma.$transaction((tx) => service.approve(distribution.id, tx));

      await Promise.all([service.initiateDisbursement(distribution.id), service.initiateDisbursement(distribution.id)]);

      // The assertion that actually proves the double-payout fix — a
      // sequential-only test can't distinguish "idempotent" from "never
      // raced in the first place".
      expect(fakePayoutAdapter.calls).toHaveLength(1);

      const updated = await prisma.vaultDistribution.findUniqueOrThrow({ where: { id: distribution.id } });
      expect(updated.status).toBe("disbursing");
    });

    test("handlePayoutWebhook() is idempotent on replay", async () => {
      const distribution = await service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, amount: "1", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
      await prisma.$transaction((tx) => service.approve(distribution.id, tx));
      await service.initiateDisbursement(distribution.id);

      const rawBody = Buffer.from(JSON.stringify({ event: "transfer.success", data: { reference: distribution.id } }));
      const result = await service.handlePayoutWebhook(rawBody, {});
      expect(result?.status).toBe("paid");
      expect(result?.paidAt).not.toBeNull();

      // Replay — idempotent no-op, not a second state change.
      const replay = await service.handlePayoutWebhook(rawBody, {});
      expect(replay?.status).toBe("paid");
      expect(replay?.paidAt?.getTime()).toBe(result?.paidAt?.getTime());
    });
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

  // The milestone gate (2026-09-13) — create() itself refuses to build
  // this distribution as a milestone's tranche until that milestone's
  // own status is "completed" (only reachable via the governed
  // vault.milestone_complete action — see governed-actions.service.ts).
  describe("milestone-gated tranche disbursement", () => {
    test("create() rejects a distribution against a milestone that isn't completed yet", async () => {
      const milestone = await milestonesService.create({ vaultId, name: "Not yet done", sequence: 101 }, actorUserId);
      await expect(
        service.create(
          { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, vaultMilestoneId: milestone.id, amount: "1", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    test("create() succeeds once the milestone is completed", async () => {
      const milestone = await milestonesService.create({ vaultId, name: "Actually done", sequence: 102 }, actorUserId);
      await prisma.$transaction((tx) => milestonesService.complete(milestone.id, tx));

      const distribution = await service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, vaultMilestoneId: milestone.id, amount: "1", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);
      expect(distribution.vaultMilestoneId).toBe(milestone.id);
    });

    // Defense-in-depth: no un-complete path exists today, but approve()
    // re-checks the milestone's status independently of create()'s own
    // check, the same "don't just trust a status read from proposal
    // time" reasoning as the headroom re-check in "allocation
    // enforcement" above. Simulates a hypothetical future un-complete
    // by writing the status back directly, same technique that
    // describe block's own "approve() re-checks headroom" test uses.
    test("approve() re-checks the milestone independently and rejects if it's no longer completed", async () => {
      const milestone = await milestonesService.create({ vaultId, name: "Completed then reverted", sequence: 103 }, actorUserId);
      await prisma.$transaction((tx) => milestonesService.complete(milestone.id, tx));

      const distribution = await service.create(
        { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, vaultMilestoneId: milestone.id, amount: "1", currency: "USD" },
        actorUserId,
      );
      vaultDistributionIds.push(distribution.id);

      await prisma.vaultMilestone.update({ where: { id: milestone.id }, data: { status: "pending", completedAt: null } });

      await prisma.$transaction(async (tx) => {
        await expect(service.approve(distribution.id, tx)).rejects.toThrow(BadRequestException);
      });
    });

    test("create() rejects a milestone that belongs to a different vault", async () => {
      const otherVault = await vaultsService.create(
        { name: "Milestone Gate Other Vault", slug: `milestone-gate-other-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG" },
        actorUserId,
      );
      vaultIds.push(otherVault.id);
      const foreignMilestone = await milestonesService.create({ vaultId: otherVault.id, name: "Wrong vault", sequence: 1 }, actorUserId);
      await prisma.$transaction((tx) => milestonesService.complete(foreignMilestone.id, tx));

      await expect(
        service.create(
          { vaultId, vaultCauseId: causeId, counterpartyId: payoutReadyCounterpartyId, vaultMilestoneId: foreignMilestone.id, amount: "1", currency: "USD" },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
