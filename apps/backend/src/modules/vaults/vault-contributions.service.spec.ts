import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { VaultContributionsService } from "./vault-contributions.service";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProviderAdapter,
  RefundInput,
  RefundResult,
  WebhookResult,
} from "../contributions/providers/payment-provider.interface";

/** Same configurable-fake pattern as ContributionsService's own spec. */
class FakeAdapter implements PaymentProviderAdapter {
  readonly provider = "stripe" as const;
  nextCreatePaymentResult: CreatePaymentResult | null = null;
  nextWebhookResult: WebhookResult | null = null;
  nextRefundError: Error | null = null;
  refundCalls: RefundInput[] = [];

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return this.nextCreatePaymentResult ?? { providerReference: input.reference, clientPayload: {} };
  }

  async verifyAndParseWebhook(): Promise<WebhookResult | null> {
    return this.nextWebhookResult;
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.refundCalls.push(input);
    if (this.nextRefundError) throw this.nextRefundError;
    return { refundReference: `fake-refund-${input.providerReference}` };
  }
}

// No refund() at all — same shape as the real StablecoinAdapter, used to
// test the "this rail has no automated refund API" path (see that
// adapter's own comment on why). Otherwise configurable the same way as
// FakeAdapter above.
class FakeAdapterWithoutRefund implements Omit<PaymentProviderAdapter, "refund"> {
  readonly provider = "stablecoin" as const;
  nextCreatePaymentResult: CreatePaymentResult | null = null;
  nextWebhookResult: WebhookResult | null = null;

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return this.nextCreatePaymentResult ?? { providerReference: input.reference, clientPayload: {} };
  }
  async verifyAndParseWebhook(): Promise<WebhookResult | null> {
    return this.nextWebhookResult;
  }
}

class FakeReceiptEmailAdapter {
  sent: Array<{ to: string; vaultName: string; causeName?: string; amount: string; currency: string; contributionId: string }> = [];

  async sendReceipt(input: {
    to: string;
    vaultName: string;
    causeName?: string;
    amount: string;
    currency: string;
    contributionId: string;
  }): Promise<void> {
    this.sent.push(input);
  }
}

describe("VaultContributionsService", () => {
  const stripeFake = new FakeAdapter();
  const paystackFake = new FakeAdapter();
  const stablecoinFake = new FakeAdapterWithoutRefund();
  const receiptEmail = new FakeReceiptEmailAdapter();
  const service = new VaultContributionsService(
    new EncryptionService(),
    receiptEmail as any,
    stripeFake as any,
    paystackFake as any,
    stablecoinFake as any,
  );
  const vaultsService = new VaultsService(new VaultProceedsService());

  const vaultIds: string[] = [];
  const vaultContributionIds: string[] = [];
  const vaultDonorEmails: string[] = [];
  let actorUserId: string;
  let openVaultId: string;
  let openVaultCauseId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `vault-contributions-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const vault = await vaultsService.create(
      {
        name: "Contributions Test Vault",
        slug: `contributions-test-${Date.now()}`,
        type: "project",
        currency: "USD",
        jurisdiction: "NG",
      },
      actorUserId,
    );
    openVaultId = vault.id;
    vaultIds.push(vault.id);
    // publish() is internal-only (the real caller is
    // GovernedActionsService's vault.publish handler) — called directly
    // here purely as fixture setup, same as every other spec's own
    // "just needs an already-open vault" shortcut.
    await prisma.$transaction((tx) => vaultsService.publish(vault.id, tx));

    const cause = await vaultsService.createCause({ vaultId: vault.id, name: "Water Wells" }, actorUserId);
    openVaultCauseId = cause.id;
  });

  afterAll(async () => {
    await prisma.vaultContribution.deleteMany({ where: { id: { in: vaultContributionIds } } });
    await prisma.vaultDonor.deleteMany({ where: { email: { in: vaultDonorEmails } } });
    await prisma.vaultCause.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.$disconnect();
  });

  function uniqueEmail(prefix: string) {
    const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
    vaultDonorEmails.push(email);
    return email;
  }

  test("initiate() rejects an amount below the configured minimum for the currency", async () => {
    await expect(
      service.initiate({
        vaultId: openVaultId,
        amount: "50.00",
        currency: "USD",
        provider: "stripe",
        donorEmail: uniqueEmail("below-min"),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("initiate() rejects a vault that isn't open", async () => {
    const draftVault = await vaultsService.create(
      { name: "Still Draft", slug: `still-draft-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(draftVault.id);

    await expect(
      service.initiate({
        vaultId: draftVault.id,
        amount: "200.00",
        currency: "USD",
        provider: "stripe",
        donorEmail: uniqueEmail("draft-vault"),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("initiate() rejects a currency that doesn't match the vault's own", async () => {
    await expect(
      service.initiate({
        vaultId: openVaultId,
        amount: "200.00",
        currency: "NGN",
        provider: "stripe",
        donorEmail: uniqueEmail("wrong-currency"),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("initiate() accepts a contribution in one of the vault's additionalCurrencies, and still rejects one that's neither", async () => {
    const multiCurrencyVault = await vaultsService.create(
      {
        name: "Multi Currency Fixture Vault",
        slug: `multi-currency-fixture-${Date.now()}`,
        type: "project",
        currency: "USD",
        jurisdiction: "NG",
        additionalCurrencies: ["NGN"],
      },
      actorUserId,
    );
    vaultIds.push(multiCurrencyVault.id);
    await prisma.$transaction((tx) => vaultsService.publish(multiCurrencyVault.id, tx));

    // NGN — an additionalCurrency, not the primary — succeeds.
    const ngnResult = await service.initiate({
      vaultId: multiCurrencyVault.id,
      amount: "200000",
      currency: "NGN",
      provider: "paystack",
      donorEmail: uniqueEmail("additional-currency"),
    });
    vaultContributionIds.push(ngnResult.contribution.id);
    expect(ngnResult.contribution.currency).toBe("NGN");

    // GBP — neither the primary nor an additionalCurrency — still rejects.
    await expect(
      service.initiate({
        vaultId: multiCurrencyVault.id,
        amount: "200",
        currency: "GBP",
        provider: "stripe",
        donorEmail: uniqueEmail("still-unaccepted-currency"),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("initiate() writes a pending VaultContribution, a matching VaultDonor, and an audit_logs record attributed to public_donor", async () => {
    const email = uniqueEmail("first-time");
    const result = await service.initiate({
      vaultId: openVaultId,
      vaultCauseId: openVaultCauseId,
      amount: "200.00",
      currency: "USD",
      provider: "stripe",
      donorEmail: email,
    });
    vaultContributionIds.push(result.contribution.id);

    expect(result.contribution.status).toBe("pending");

    const donor = await prisma.vaultDonor.findUnique({ where: { email } });
    expect(donor).not.toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: result.contribution.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorType: "public_donor",
      actorDonorId: donor!.id,
      vaultId: openVaultId,
      action: "vault_contribution.initiated",
    });
  });

  test("initiate() reuses the same VaultDonor across two contributions from the same email", async () => {
    const email = uniqueEmail("repeat-donor");
    const first = await service.initiate({
      vaultId: openVaultId,
      amount: "200.00",
      currency: "USD",
      provider: "stripe",
      donorEmail: email,
    });
    vaultContributionIds.push(first.contribution.id);
    const second = await service.initiate({
      vaultId: openVaultId,
      amount: "150.00",
      currency: "USD",
      provider: "stripe",
      donorEmail: email,
    });
    vaultContributionIds.push(second.contribution.id);

    const donors = await prisma.vaultDonor.findMany({ where: { email } });
    expect(donors).toHaveLength(1);
    expect(first.contribution.donorId).toBe(second.contribution.donorId);
  });

  test("initiate() allows a fully anonymous contribution — no donorEmail, no VaultDonor row, actorDonorId null", async () => {
    const result = await service.initiate({
      vaultId: openVaultId,
      amount: "200.00",
      currency: "USD",
      provider: "stripe",
    });
    vaultContributionIds.push(result.contribution.id);

    expect(result.contribution.status).toBe("pending");
    expect(result.contribution.donorId).toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: result.contribution.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "public_donor", actorDonorId: null, vaultId: openVaultId });
  });

  test("handleWebhook() confirms an anonymous contribution without attempting a receipt", async () => {
    const initiated = await service.initiate({
      vaultId: openVaultId,
      amount: "200.00",
      currency: "USD",
      provider: "stripe",
    });
    vaultContributionIds.push(initiated.contribution.id);

    stripeFake.nextWebhookResult = { providerReference: initiated.contribution.providerReference, status: "confirmed" };
    const sentBefore = receiptEmail.sent.length;
    const confirmed = await service.handleWebhook("stripe", Buffer.from(""), {});

    expect(confirmed?.status).toBe("confirmed");
    expect(receiptEmail.sent.length).toBe(sentBefore);
  });

  describe("AML identity-capture threshold", () => {
    let currency: string;
    // A second currency/vault pair — needed to test that the threshold
    // check now accumulates across currencies, not just within one (a
    // single vault only ever accepts its own one currency, so this is
    // the only way to give in two currencies as the same donor).
    let currencyB: string;
    let secondVaultId: string;

    beforeAll(async () => {
      currency = `AML${Date.now() % 100000}`;
      await prisma.contributionMinimum.create({ data: { currency, minAmount: "10" } });
      await prisma.vaultDonorThreshold.create({ data: { currency, thresholdAmount: "1000" } });
      await prisma.vault.update({ where: { id: openVaultId }, data: { currency } });

      currencyB = `AMLB${Date.now() % 100000}`;
      await prisma.contributionMinimum.create({ data: { currency: currencyB, minAmount: "10" } });
      await prisma.vaultDonorThreshold.create({ data: { currency: currencyB, thresholdAmount: "500" } });
      const secondVault = await vaultsService.create(
        { name: "Second Currency Fixture Vault", slug: `second-currency-${Date.now()}`, type: "project", currency: currencyB, jurisdiction: "NG" },
        actorUserId,
      );
      secondVaultId = secondVault.id;
      vaultIds.push(secondVault.id);
      await prisma.$transaction((tx) => vaultsService.publish(secondVault.id, tx));
    });

    afterAll(async () => {
      await prisma.vault.update({ where: { id: openVaultId }, data: { currency: "USD" } });
      await prisma.vaultDonorThreshold.deleteMany({ where: { currency: { in: [currency, currencyB] } } });
      await prisma.contributionMinimum.deleteMany({ where: { currency: { in: [currency, currencyB] } } });
    });

    test("a single contribution at or above the threshold requires donorFullName/idType/idNumber", async () => {
      const email = uniqueEmail("single-large");
      await expect(
        service.initiate({
          vaultId: openVaultId,
          amount: "1000",
          currency,
          provider: "stripe",
          donorEmail: email,
        }),
      ).rejects.toThrow(BadRequestException);

      const result = await service.initiate({
        vaultId: openVaultId,
        amount: "1000",
        currency,
        provider: "stripe",
        donorEmail: email,
        donorFullName: "Amina Yusuf",
        idType: "national_id",
        idNumber: "A123456789",
      });
      vaultContributionIds.push(result.contribution.id);

      const donor = await prisma.vaultDonor.findUnique({ where: { email } });
      expect(donor?.idType).toBe("national_id");
      expect(donor?.idNumberEncrypted).not.toBeNull();
      expect(donor?.idNumberEncrypted).not.toBe("A123456789");
    });

    test("cumulative giving crossing the threshold requires identity even though no single gift did", async () => {
      const email = uniqueEmail("cumulative");
      const first = await service.initiate({
        vaultId: openVaultId,
        amount: "600",
        currency,
        provider: "stripe",
        donorEmail: email,
      });
      vaultContributionIds.push(first.contribution.id);
      // Manually confirm the first so its amount counts toward the
      // "existing confirmed total" half of the threshold check — a
      // still-pending contribution shouldn't (and per the implementation
      // doesn't) count as already-given.
      await prisma.vaultContribution.update({ where: { id: first.contribution.id }, data: { status: "confirmed" } });

      await expect(
        service.initiate({
          vaultId: openVaultId,
          amount: "500",
          currency,
          provider: "stripe",
          donorEmail: email,
        }),
      ).rejects.toThrow(BadRequestException);

      const second = await service.initiate({
        vaultId: openVaultId,
        amount: "500",
        currency,
        provider: "stripe",
        donorEmail: email,
        donorFullName: "Second Donor",
        idType: "passport",
        idNumber: "P987654321",
      });
      vaultContributionIds.push(second.contribution.id);
    });

    test("giving across two different currencies (two vaults) accumulates toward the same donor's compliance threshold", async () => {
      const email = uniqueEmail("cross-currency");

      // 60% of currency A's threshold (1000/1000 -> 600 = 0.6) — well
      // under it alone, exactly like the single-currency case above.
      const first = await service.initiate({
        vaultId: openVaultId,
        amount: "600",
        currency,
        provider: "stripe",
        donorEmail: email,
      });
      vaultContributionIds.push(first.contribution.id);
      await prisma.vaultContribution.update({ where: { id: first.contribution.id }, data: { status: "confirmed" } });

      // 60% of currency B's threshold (500) — also under it alone. A
      // purely per-currency check would let this through; combined
      // with the 0.6 already used in currency A, this donor has used
      // 1.2x their compliance headroom overall.
      await expect(
        service.initiate({
          vaultId: secondVaultId,
          amount: "300",
          currency: currencyB,
          provider: "stripe",
          donorEmail: email,
        }),
      ).rejects.toThrow(BadRequestException);

      const identified = await service.initiate({
        vaultId: secondVaultId,
        amount: "300",
        currency: currencyB,
        provider: "stripe",
        donorEmail: email,
        donorFullName: "Cross Currency Donor",
        idType: "passport",
        idNumber: "CC123456",
      });
      vaultContributionIds.push(identified.contribution.id);
    });

    test("once identified, a later contribution from the same donor doesn't require re-identification", async () => {
      const email = uniqueEmail("already-identified");
      const first = await service.initiate({
        vaultId: openVaultId,
        amount: "1000",
        currency,
        provider: "stripe",
        donorEmail: email,
        donorFullName: "Identified Donor",
        idType: "other",
        idNumber: "X1",
      });
      vaultContributionIds.push(first.contribution.id);

      const second = await service.initiate({
        vaultId: openVaultId,
        amount: "1000",
        currency,
        provider: "stripe",
        donorEmail: email,
      });
      vaultContributionIds.push(second.contribution.id);
      expect(second.contribution.status).toBe("pending");
    });
  });

  describe("handleWebhook()", () => {
    afterEach(() => {
      stripeFake.nextWebhookResult = null;
    });

    test("confirms a pending contribution, sends a receipt, and writes an audit_logs record", async () => {
      const email = uniqueEmail("webhook-confirm");
      const result = await service.initiate({
        vaultId: openVaultId,
        vaultCauseId: openVaultCauseId,
        amount: "200.00",
        currency: "USD",
        provider: "stripe",
        donorEmail: email,
      });
      vaultContributionIds.push(result.contribution.id);

      stripeFake.nextWebhookResult = { providerReference: result.contribution.providerReference, status: "confirmed" };
      const confirmed = await service.handleWebhook("stripe", Buffer.from("{}"), {});
      expect(confirmed?.status).toBe("confirmed");

      const logs = await prisma.auditLog.findMany({
        where: { entityId: result.contribution.id, action: "vault_contribution.confirmed" },
      });
      expect(logs).toHaveLength(1);

      const receipt = receiptEmail.sent.find((r) => r.contributionId === result.contribution.id);
      expect(receipt).toMatchObject({ to: email, vaultName: "Contributions Test Vault", causeName: "Water Wells" });
    });

    test("is idempotent on a webhook retry for an already-processed contribution", async () => {
      const result = await service.initiate({
        vaultId: openVaultId,
        amount: "200.00",
        currency: "USD",
        provider: "stripe",
        donorEmail: uniqueEmail("webhook-idempotent"),
      });
      vaultContributionIds.push(result.contribution.id);

      stripeFake.nextWebhookResult = { providerReference: result.contribution.providerReference, status: "confirmed" };
      await service.handleWebhook("stripe", Buffer.from("{}"), {});
      const sentCountAfterFirst = receiptEmail.sent.length;

      const second = await service.handleWebhook("stripe", Buffer.from("{}"), {});
      expect(second?.status).toBe("confirmed");
      expect(receiptEmail.sent).toHaveLength(sentCountAfterFirst);
    });

    test("throws UnauthorizedException on an invalid webhook signature", async () => {
      stripeFake.nextWebhookResult = null;
      await expect(service.handleWebhook("stripe", Buffer.from("{}"), {})).rejects.toThrow(UnauthorizedException);
    });

    test("returns null (not mine — lets the dispatch chain end) for a valid signature with an unrecognized reference", async () => {
      stripeFake.nextWebhookResult = { providerReference: "not-a-real-reference", status: "confirmed" };
      expect(await service.handleWebhook("stripe", Buffer.from("{}"), {})).toBeNull();
    });
  });

  test("initiate() throws NotFoundException for an unknown vaultId", async () => {
    await expect(
      service.initiate({
        vaultId: "00000000-0000-0000-0000-000000000000",
        amount: "200.00",
        currency: "USD",
        provider: "stripe",
        donorEmail: uniqueEmail("unknown-vault"),
      }),
    ).rejects.toThrow(NotFoundException);
  });

  describe("hold() / release()", () => {
    async function confirmedContribution() {
      const result = await service.initiate({
        vaultId: openVaultId,
        amount: "200.00",
        currency: "USD",
        provider: "stripe",
        donorEmail: uniqueEmail("hold-release"),
      });
      vaultContributionIds.push(result.contribution.id);
      stripeFake.nextWebhookResult = { providerReference: result.contribution.providerReference, status: "confirmed" };
      const confirmed = await service.handleWebhook("stripe", Buffer.from("{}"), {});
      return confirmed!;
    }

    test("hold() flags a confirmed contribution, audit-logged; release() clears it, audit-logged", async () => {
      const contribution = await confirmedContribution();

      const held = await service.hold(contribution.id, "Suspected structuring", actorUserId);
      expect(held.heldAt).not.toBeNull();
      expect(held.heldReason).toBe("Suspected structuring");
      expect(held.status).toBe("confirmed"); // unaffected — held is independent of payment status

      let logs = await prisma.auditLog.findMany({ where: { entityId: contribution.id, action: "vault_contribution.held" } });
      expect(logs).toHaveLength(1);

      const released = await service.release(contribution.id, actorUserId);
      expect(released.heldAt).toBeNull();
      expect(released.heldReason).toBeNull();

      logs = await prisma.auditLog.findMany({ where: { entityId: contribution.id, action: "vault_contribution.hold_released" } });
      expect(logs).toHaveLength(1);
    });

    test("hold() rejects a contribution that isn't confirmed, and a second hold on an already-held one", async () => {
      const result = await service.initiate({
        vaultId: openVaultId,
        amount: "200.00",
        currency: "USD",
        provider: "stripe",
        donorEmail: uniqueEmail("hold-pending"),
      });
      vaultContributionIds.push(result.contribution.id);

      await expect(service.hold(result.contribution.id, "premature", actorUserId)).rejects.toThrow(BadRequestException);

      const contribution = await confirmedContribution();
      await service.hold(contribution.id, "first hold", actorUserId);
      await expect(service.hold(contribution.id, "second hold", actorUserId)).rejects.toThrow(BadRequestException);
    });

    test("release() rejects a contribution that isn't currently held", async () => {
      const contribution = await confirmedContribution();
      await expect(service.release(contribution.id, actorUserId)).rejects.toThrow(BadRequestException);
    });
  });

  describe("requestRefund() / initiateRefund()", () => {
    async function confirmedContribution(provider: "stripe" | "stablecoin" = "stripe") {
      const result = await service.initiate({
        vaultId: openVaultId,
        amount: "200.00",
        currency: "USD",
        provider,
        donorEmail: uniqueEmail("refund"),
      });
      vaultContributionIds.push(result.contribution.id);
      const webhookResult: WebhookResult = { providerReference: result.contribution.providerReference, status: "confirmed" };
      if (provider === "stripe") {
        stripeFake.nextWebhookResult = webhookResult;
      } else {
        stablecoinFake.nextWebhookResult = webhookResult;
      }
      const confirmed = await service.handleWebhook(provider, Buffer.from("{}"), {});
      return confirmed!;
    }

    test("requestRefund() sets refundStatus to requested; rejects a non-confirmed contribution and a duplicate request", async () => {
      const contribution = await confirmedContribution();

      const requested = await prisma.$transaction((tx) => service.requestRefund(contribution.id, tx));
      expect(requested.refundStatus).toBe("requested");

      await expect(prisma.$transaction((tx) => service.requestRefund(contribution.id, tx))).rejects.toThrow(BadRequestException);

      const pendingResult = await service.initiate({
        vaultId: openVaultId,
        amount: "200.00",
        currency: "USD",
        provider: "stripe",
        donorEmail: uniqueEmail("refund-pending"),
      });
      vaultContributionIds.push(pendingResult.contribution.id);
      await expect(
        prisma.$transaction((tx) => service.requestRefund(pendingResult.contribution.id, tx)),
      ).rejects.toThrow(BadRequestException);
    });

    test("initiateRefund() calls the adapter's real refund() for a rail that supports it, records refundReference, audit-logged", async () => {
      const contribution = await confirmedContribution("stripe");
      await prisma.$transaction((tx) => service.requestRefund(contribution.id, tx));

      await service.initiateRefund(contribution.id);

      const refunded = await prisma.vaultContribution.findUniqueOrThrow({ where: { id: contribution.id } });
      expect(refunded.refundStatus).toBe("refunded");
      expect(refunded.refundedAt).not.toBeNull();
      expect(refunded.refundReference).toBe(`fake-refund-${contribution.providerReference}`);
      expect(stripeFake.refundCalls.some((c) => c.providerReference === contribution.providerReference)).toBe(true);

      const logs = await prisma.auditLog.findMany({ where: { entityId: contribution.id, action: "vault_contribution.refunded" } });
      expect(logs).toHaveLength(1);
    });

    test("initiateRefund() is claimed atomically — calling it twice only refunds once", async () => {
      const contribution = await confirmedContribution("stripe");
      await prisma.$transaction((tx) => service.requestRefund(contribution.id, tx));

      await Promise.all([service.initiateRefund(contribution.id), service.initiateRefund(contribution.id)]);

      const calls = stripeFake.refundCalls.filter((c) => c.providerReference === contribution.providerReference);
      expect(calls).toHaveLength(1);
    });

    test("initiateRefund() records refundStatus: failed when the adapter's refund() throws", async () => {
      const contribution = await confirmedContribution("stripe");
      await prisma.$transaction((tx) => service.requestRefund(contribution.id, tx));

      stripeFake.nextRefundError = new Error("Card issuer declined the refund");
      await service.initiateRefund(contribution.id);
      stripeFake.nextRefundError = null;

      const failed = await prisma.vaultContribution.findUniqueOrThrow({ where: { id: contribution.id } });
      expect(failed.refundStatus).toBe("failed");
      expect(failed.refundFailedReason).toBe("Card issuer declined the refund");

      const logs = await prisma.auditLog.findMany({ where: { entityId: contribution.id, action: "vault_contribution.refund_failed" } });
      expect(logs).toHaveLength(1);
    });

    test("initiateRefund() on a rail with no refund() (stablecoin) still records refunded, with a null refundReference", async () => {
      const contribution = await confirmedContribution("stablecoin");
      await prisma.$transaction((tx) => service.requestRefund(contribution.id, tx));

      await service.initiateRefund(contribution.id);

      const refunded = await prisma.vaultContribution.findUniqueOrThrow({ where: { id: contribution.id } });
      expect(refunded.refundStatus).toBe("refunded");
      expect(refunded.refundReference).toBeNull();
    });
  });
});
