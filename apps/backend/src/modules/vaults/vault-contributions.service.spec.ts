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
  WebhookResult,
} from "../contributions/providers/payment-provider.interface";

/** Same configurable-fake pattern as ContributionsService's own spec. */
class FakeAdapter implements PaymentProviderAdapter {
  readonly provider = "stripe" as const;
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
  const stablecoinFake = new FakeAdapter();
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
    await vaultsService.updateStatus(vault.id, "open", actorUserId);

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

    beforeAll(async () => {
      currency = `AML${Date.now() % 100000}`;
      await prisma.contributionMinimum.create({ data: { currency, minAmount: "10" } });
      await prisma.vaultDonorThreshold.create({ data: { currency, thresholdAmount: "1000" } });
      await prisma.vault.update({ where: { id: openVaultId }, data: { currency } });
    });

    afterAll(async () => {
      await prisma.vault.update({ where: { id: openVaultId }, data: { currency: "USD" } });
      await prisma.vaultDonorThreshold.deleteMany({ where: { currency } });
      await prisma.contributionMinimum.deleteMany({ where: { currency } });
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
});
