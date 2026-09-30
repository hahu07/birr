import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { VaultContributionsService } from "./vault-contributions.service";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";
import { VaultLedgerService } from "./vault-ledger.service";
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProviderAdapter,
  RefundInput,
  RefundResult,
  WebhookResult,
} from "../contributions/providers/payment-provider.interface";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";

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
  const ledger = new VaultLedgerService();
  const service = new VaultContributionsService(
    new EncryptionService(),
    receiptEmail as any,
    ledger,
    new FunnelEventsService(),
    stripeFake as any,
    paystackFake as any,
    stablecoinFake as any,
  );
  const vaultsService = new VaultsService(new VaultProceedsService(), ledger);

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
    // Journal entry lines before their entries before the vault itself
    // — the confirmed-contribution auto-post hook (2026-09-13) means
    // these fixture vaults now have VaultJournalEntry rows referencing
    // them, with no onDelete: Cascade on that FK.
    await prisma.vaultJournalEntryLine.deleteMany({ where: { journalEntry: { vaultId: { in: vaultIds } } } });
    await prisma.vaultJournalEntry.deleteMany({ where: { vaultId: { in: vaultIds } } });
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

  test("initiate() stores the server-captured ipAddress on the contribution, and leaves it null when none is passed", async () => {
    const withIp = await service.initiate(
      { vaultId: openVaultId, amount: "200.00", currency: "USD", provider: "stripe", donorEmail: uniqueEmail("with-ip") },
      "203.0.113.7",
    );
    vaultContributionIds.push(withIp.contribution.id);
    expect(withIp.contribution.ipAddress).toBe("203.0.113.7");

    const withoutIp = await service.initiate({
      vaultId: openVaultId,
      amount: "200.00",
      currency: "USD",
      provider: "stripe",
      donorEmail: uniqueEmail("without-ip"),
    });
    vaultContributionIds.push(withoutIp.contribution.id);
    expect(withoutIp.contribution.ipAddress).toBeNull();
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

    // 2026-09-29: reversed from "once identified, never asked again" —
    // reusing an identified donor's (unverified) email used to skip ID
    // capture entirely, leaving someone else's ID on file for the money.
    test("an identified donor over the threshold must re-enter the matching ID on file", async () => {
      const email = uniqueEmail("already-identified");
      const first = await service.initiate({
        vaultId: openVaultId,
        amount: "1000",
        currency,
        provider: "stripe",
        donorEmail: email,
        donorFullName: "Identified Donor",
        idType: "other",
        idNumber: "X1-234",
      });
      vaultContributionIds.push(first.contribution.id);

      await expect(
        service.initiate({ vaultId: openVaultId, amount: "1000", currency, provider: "stripe", donorEmail: email }),
      ).rejects.toMatchObject({ response: { code: "IDENTITY_CONFIRMATION_REQUIRED" } });

      await expect(
        service.initiate({ vaultId: openVaultId, amount: "1000", currency, provider: "stripe", donorEmail: email, idType: "other", idNumber: "SOMEONE-ELSE" }),
      ).rejects.toMatchObject({ response: { code: "IDENTITY_MISMATCH" } });

      // Same ID, formatted differently (spacing/case/hyphens), is accepted.
      const second = await service.initiate({
        vaultId: openVaultId,
        amount: "1000",
        currency,
        provider: "stripe",
        donorEmail: email,
        idType: "other",
        idNumber: "x1 234",
      });
      vaultContributionIds.push(second.contribution.id);
      expect(second.contribution.status).toBe("pending");
    });

    test("pending gifts under the same email count toward the threshold — they can't be started in parallel to dodge it", async () => {
      const email = uniqueEmail("parallel-pending");
      // Each 600 is under the 1000 threshold alone; none is confirmed yet.
      const results = await Promise.allSettled([
        service.initiate({ vaultId: openVaultId, amount: "600", currency, provider: "stripe", donorEmail: email }),
        service.initiate({ vaultId: openVaultId, amount: "600", currency, provider: "stripe", donorEmail: email }),
      ]);
      for (const r of results) if (r.status === "fulfilled") vaultContributionIds.push(r.value.contribution.id);

      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ response: { code: "IDENTITY_REQUIRED" } });
    });

    test("an existing donor's identity is never overwritten by later unauthenticated input", async () => {
      const email = uniqueEmail("no-overwrite");
      const first = await service.initiate({
        vaultId: openVaultId,
        amount: "20",
        currency,
        provider: "stripe",
        donorEmail: email,
        donorFullName: "Original Name",
        idType: "passport",
        idNumber: "ORIGINAL1",
      });
      vaultContributionIds.push(first.contribution.id);

      const second = await service.initiate({
        vaultId: openVaultId,
        amount: "20",
        currency,
        provider: "stripe",
        donorEmail: email,
        donorFullName: "Attacker Name",
        idType: "national_id",
        idNumber: "ATTACKER9",
      });
      vaultContributionIds.push(second.contribution.id);

      const donor = await prisma.vaultDonor.findUniqueOrThrow({ where: { email } });
      expect(donor.fullName).toBe("Original Name");
      expect(donor.idType).toBe("passport");
      expect(new EncryptionService().decrypt(donor.idNumberEncrypted!)).toBe("ORIGINAL1");
    });

    test("differently-cased emails are the same donor, so they share one threshold", async () => {
      const email = uniqueEmail("case-fold");
      const first = await service.initiate({ vaultId: openVaultId, amount: "600", currency, provider: "stripe", donorEmail: email });
      vaultContributionIds.push(first.contribution.id);

      await expect(
        service.initiate({ vaultId: openVaultId, amount: "600", currency, provider: "stripe", donorEmail: `  ${email.toUpperCase()} ` }),
      ).rejects.toMatchObject({ response: { code: "IDENTITY_REQUIRED" } });
      expect(await prisma.vaultDonor.count({ where: { email: { equals: email, mode: "insensitive" } } })).toBe(1);
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

      // Double-entry auto-post (2026-09-13) — confirming a contribution
      // should post a balanced Cash & Bank debit / Donations Revenue
      // credit journal entry, same amount as the contribution itself.
      const journalEntry = await prisma.vaultJournalEntry.findFirst({
        where: { source: "contribution", sourceId: result.contribution.id },
        include: { lines: { include: { ledgerAccount: true } } },
      });
      expect(journalEntry?.lines).toHaveLength(2);
      expect(journalEntry?.lines.find((l) => l.ledgerAccount.code === "1000")?.debit.toString()).toBe("200");
      expect(journalEntry?.lines.find((l) => l.ledgerAccount.code === "4000")?.credit.toString()).toBe("200");
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

    test("two concurrent deliveries of the same webhook confirm once: one ledger entry, one audit record, one receipt", async () => {
      const result = await service.initiate({
        vaultId: openVaultId,
        amount: "150.00",
        currency: "USD",
        provider: "stripe",
        donorEmail: uniqueEmail("webhook-race"),
      });
      vaultContributionIds.push(result.contribution.id);
      const receiptsBefore = receiptEmail.sent.filter((r) => r.contributionId === result.contribution.id).length;

      stripeFake.nextWebhookResult = { providerReference: result.contribution.providerReference, status: "confirmed" };
      const outcomes = await Promise.all([
        service.handleWebhook("stripe", Buffer.from("{}"), {}),
        service.handleWebhook("stripe", Buffer.from("{}"), {}),
      ]);
      expect(outcomes.every((o) => o?.status === "confirmed")).toBe(true);

      expect(await prisma.vaultJournalEntry.count({ where: { source: "contribution", sourceId: result.contribution.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: result.contribution.id, action: "vault_contribution.confirmed" } })).toBe(1);
      expect(receiptEmail.sent.filter((r) => r.contributionId === result.contribution.id).length).toBe(receiptsBefore + 1);
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

  describe("findPublicStatus()", () => {
    test("returns only donor-safe fields — never ipAddress, heldReason, donorId, or provider references", async () => {
      const result = await service.initiate(
        { vaultId: openVaultId, amount: "200.00", currency: "USD", provider: "stripe", donorEmail: uniqueEmail("public-status") },
        "203.0.113.9",
      );
      vaultContributionIds.push(result.contribution.id);
      await prisma.vaultContribution.update({
        where: { id: result.contribution.id },
        data: { status: "confirmed", heldAt: new Date(), heldReason: "Possible structuring — see IP cluster" },
      });

      const publicView = await service.findPublicStatus(result.contribution.id);
      expect(publicView).toMatchObject({ id: result.contribution.id, status: "confirmed", vault: { name: "Contributions Test Vault" } });
      for (const hidden of ["ipAddress", "heldReason", "heldAt", "donorId", "providerReference", "providerPaymentId", "refundFailedReason"]) {
        expect(publicView).not.toHaveProperty(hidden);
      }
    });
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

      // The refund reverses the confirmation's posting, so the books no
      // longer show money that went back to the donor.
      const reversal = await prisma.vaultJournalEntry.findFirst({
        where: { source: "contribution_refund", sourceId: contribution.id },
        include: { lines: { include: { ledgerAccount: true } } },
      });
      expect(reversal?.lines.find((l) => l.ledgerAccount.code === "4000")?.debit.toString()).toBe("200");
      expect(reversal?.lines.find((l) => l.ledgerAccount.code === "1000")?.credit.toString()).toBe("200");
    });

    test("a refunded contribution no longer counts as raised on the public vault page", async () => {
      const before = await vaultsService.findBySlug((await prisma.vault.findUniqueOrThrow({ where: { id: openVaultId } })).slug);
      const raisedBefore = Number(before!.amountRaised.find((r) => r.currency === "USD")?.amount ?? "0");

      const contribution = await confirmedContribution("stripe");
      await prisma.$transaction((tx) => service.requestRefund(contribution.id, tx));
      await service.initiateRefund(contribution.id);

      const after = await vaultsService.findBySlug((await prisma.vault.findUniqueOrThrow({ where: { id: openVaultId } })).slug);
      expect(Number(after!.amountRaised.find((r) => r.currency === "USD")?.amount ?? "0")).toBe(raisedBefore);
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

  // The manual/off-platform AML review CLAUDE.md's own dated note
  // points to (2026-09-15) — direct fixture rows, not the full
  // initiate()/handleWebhook() dance, since this is a read-only report
  // over already-confirmed data.
  describe("getStructuringReview()", () => {
    let currency: string;
    let reviewVaultId: string;
    const donorIds: string[] = [];
    const contributionIds: string[] = [];

    beforeAll(async () => {
      currency = `STRUCT${Date.now() % 100000}`;
      await prisma.vaultDonorThreshold.create({ data: { currency, thresholdAmount: "1000" } });

      const vault = await vaultsService.create(
        { name: "Structuring Review Fixture Vault", slug: `structuring-review-${Date.now()}`, type: "project", currency, jurisdiction: "NG" },
        actorUserId,
      );
      reviewVaultId = vault.id;
      vaultIds.push(vault.id);
      await prisma.$transaction((tx) => vaultsService.publish(vault.id, tx));
    });

    afterAll(async () => {
      await prisma.vaultContribution.deleteMany({ where: { id: { in: contributionIds } } });
      await prisma.vaultDonor.deleteMany({ where: { id: { in: donorIds } } });
      await prisma.vaultDonorThreshold.deleteMany({ where: { currency } });
    });

    async function confirmedContributionFromDonor(email: string, amount: string) {
      const donor = await prisma.vaultDonor.create({ data: { email } });
      donorIds.push(donor.id);
      const contribution = await prisma.vaultContribution.create({
        data: {
          vaultId: reviewVaultId,
          donorId: donor.id,
          amount,
          currency,
          provider: "stripe",
          providerReference: `structuring-review-${donor.id}`,
          status: "confirmed",
        },
      });
      contributionIds.push(contribution.id);
      return contribution;
    }

    test("groups near-threshold contributions from different donors to the same vault/currency", async () => {
      await confirmedContributionFromDonor(uniqueEmail("structuring-a"), "999");
      await confirmedContributionFromDonor(uniqueEmail("structuring-b"), "998");

      const { groups } = await service.getStructuringReview();
      const group = groups.find((g) => g.vaultId === reviewVaultId);
      expect(group).toBeDefined();
      expect(group!.distinctDonorCount).toBe(2);
      expect(group!.contributions).toHaveLength(2);
      expect(group!.contributions.every((c) => c.fractionOfThreshold >= 0.5)).toBe(true);
    });

    test("does not group a single donor's one large gift — nothing to compare it against", async () => {
      const soloCurrency = `STRUCTSOLO${Date.now() % 100000}`;
      await prisma.vaultDonorThreshold.create({ data: { currency: soloCurrency, thresholdAmount: "1000" } });
      const soloVault = await vaultsService.create(
        { name: "Structuring Review Solo Vault", slug: `structuring-solo-${Date.now()}`, type: "project", currency: soloCurrency, jurisdiction: "NG" },
        actorUserId,
      );
      vaultIds.push(soloVault.id);
      await prisma.$transaction((tx) => vaultsService.publish(soloVault.id, tx));

      const donor = await prisma.vaultDonor.create({ data: { email: uniqueEmail("structuring-solo") } });
      donorIds.push(donor.id);
      const contribution = await prisma.vaultContribution.create({
        data: {
          vaultId: soloVault.id,
          donorId: donor.id,
          amount: "999",
          currency: soloCurrency,
          provider: "stripe",
          providerReference: `structuring-solo-${donor.id}`,
          status: "confirmed",
        },
      });
      contributionIds.push(contribution.id);

      const { groups } = await service.getStructuringReview();
      expect(groups.find((g) => g.vaultId === soloVault.id)).toBeUndefined();

      await prisma.vaultDonorThreshold.deleteMany({ where: { currency: soloCurrency } });
    });

    test("ignores contributions well below minFraction of the threshold", async () => {
      await confirmedContributionFromDonor(uniqueEmail("structuring-low-a"), "100");
      await confirmedContributionFromDonor(uniqueEmail("structuring-low-b"), "90");

      const { groups } = await service.getStructuringReview(0.5);
      const group = groups.find((g) => g.vaultId === reviewVaultId);
      // The earlier near-threshold pair is still there — these two new,
      // low ones must not have joined it.
      expect(group!.contributions.some((c) => c.amount === "100")).toBe(false);
      expect(group!.contributions.some((c) => c.amount === "90")).toBe(false);
    });

    test("a currency with no VaultDonorThreshold row is skipped entirely", async () => {
      const { groups } = await service.getStructuringReview();
      expect(groups.every((g) => g.currency !== "NO-THRESHOLD-CURRENCY")).toBe(true);
    });
  });

  // Regression coverage for the 2026-09-26 advanced enhancement — the
  // second, complementary signal alongside the near-threshold grouping
  // above. Deliberately amount-independent and not vault/currency-scoped
  // (see getIpClusters()'s own comment), so these fixtures use small,
  // ordinary amounts on the shared openVaultId fixture rather than a
  // dedicated threshold/vault setup.
  describe("getStructuringReview() ipClusters", () => {
    // No extra tracking/cleanup needed here — every donor below is
    // created via uniqueEmail() (already collected into the outer
    // vaultDonorEmails array) and every contribution's id is pushed onto
    // the outer vaultContributionIds, both already cleaned up by this
    // describe block's own outer afterAll, in the correct FK order.
    async function confirmedContribution(opts: { email?: string; donorId?: string; ipAddress: string | null; amount?: string }) {
      // donorId takes precedence when both are given — lets a test reuse
      // one already-created VaultDonor across two contributions (email is
      // @unique, so a fresh donor can't be created twice for the same
      // address the way findOrCreateDonor's real find-or-create would).
      const donorId = opts.donorId ?? (opts.email ? (await prisma.vaultDonor.create({ data: { email: opts.email } })).id : undefined);
      const contribution = await prisma.vaultContribution.create({
        data: {
          vaultId: openVaultId,
          donorId,
          amount: opts.amount ?? "50",
          currency: "USD",
          provider: "stripe",
          providerReference: `ip-cluster-spec-${donorId ?? "anon"}-${Date.now()}-${Math.random()}`,
          status: "confirmed",
          ipAddress: opts.ipAddress,
        },
      });
      vaultContributionIds.push(contribution.id);
      return contribution;
    }

    test("clusters two different declared donors who gave from the same IP", async () => {
      const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
      await confirmedContribution({ email: uniqueEmail("ip-cluster-a"), ipAddress: ip });
      await confirmedContribution({ email: uniqueEmail("ip-cluster-b"), ipAddress: ip });

      const { ipClusters } = await service.getStructuringReview();
      const cluster = ipClusters.find((c) => c.ipAddress === ip);
      expect(cluster).toBeDefined();
      expect(cluster!.distinctDonorCount).toBe(2);
      expect(cluster!.contributions).toHaveLength(2);
    });

    test("does not cluster the same donor giving twice from the same IP", async () => {
      const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
      const donor = await prisma.vaultDonor.create({ data: { email: uniqueEmail("ip-cluster-solo") } });
      await confirmedContribution({ donorId: donor.id, ipAddress: ip });
      await confirmedContribution({ donorId: donor.id, ipAddress: ip });

      const { ipClusters } = await service.getStructuringReview();
      expect(ipClusters.find((c) => c.ipAddress === ip)).toBeUndefined();
    });

    test("excludes anonymous (no-email) contributions — they have no declared identity to compare", async () => {
      const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
      await confirmedContribution({ email: uniqueEmail("ip-cluster-named"), ipAddress: ip });
      await confirmedContribution({ ipAddress: ip }); // anonymous — no email, no donorId

      const { ipClusters } = await service.getStructuringReview();
      // Only one real declared donor used this IP — the anonymous gift
      // must not be counted as a second one.
      expect(ipClusters.find((c) => c.ipAddress === ip)).toBeUndefined();
    });

    test("ignores contributions with no ipAddress at all", async () => {
      await confirmedContribution({ email: uniqueEmail("no-ip-a"), ipAddress: null });
      await confirmedContribution({ email: uniqueEmail("no-ip-b"), ipAddress: null });

      const { ipClusters } = await service.getStructuringReview();
      expect(ipClusters.every((c) => c.ipAddress !== null)).toBe(true);
    });
  });
});
