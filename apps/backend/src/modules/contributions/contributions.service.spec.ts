import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { prisma, Asset, Waqf } from "@birr/db";
import { ContributionsService } from "./contributions.service";
import { AssetsService } from "../assets/assets.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProviderAdapter,
  WebhookResult,
} from "./providers/payment-provider.interface";

/**
 * A configurable fake — no real network calls to Stripe/Paystack/the
 * stablecoin gateway. `nextCreatePaymentResult`/`nextWebhookResult` are
 * set per-test to drive the specific scenario being exercised.
 */
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

describe("ContributionsService", () => {
  const stripeFake = new FakeAdapter();
  const paystackFake = new FakeAdapter();
  const stablecoinFake = new FakeAdapter();
  const service = new ContributionsService(
    new AssetsService(),
    createFakeNotificationsService(),
    stripeFake as any,
    paystackFake as any,
    stablecoinFake as any,
  );

  const waqfIds: string[] = [];
  const contributionIds: string[] = [];
  const assetIds: string[] = [];

  let founderId: string;
  let otherFounderId: string;
  let foundationId: string;
  let waqfId: string;
  let installmentWaqfId: string;
  let lumpSumWaqfId: string;

  beforeAll(async () => {
    const founder = await prisma.founder.create({
      data: { name: "Contributions Spec Founder", kind: "institution" },
    });
    founderId = founder.id;
    const otherFounder = await prisma.founder.create({
      data: { name: "Contributions Spec Other Founder", kind: "institution" },
    });
    otherFounderId = otherFounder.id;

    const foundation = await prisma.foundation.create({ data: { name: "Contributions Spec Foundation" } });
    foundationId = foundation.id;
    await prisma.foundationFounder.create({ data: { foundationId, founderId } });

    const waqf = await prisma.waqf.create({
      data: { name: "Contributions Spec Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);

    // Separate fixture waqf, not shared with the lump-sum tests above —
    // its own confirmed-contribution count needs to start at zero for
    // the installment-floor tests below to actually exercise "this is
    // the first payment" rather than accidentally inheriting state from
    // an earlier test.
    const installmentWaqf = await prisma.waqf.create({
      data: {
        name: "Contributions Spec Installment Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId,
        fundingPlan: "installment",
        corpusAmount: "10000",
        corpusCurrency: "USD",
      },
    });
    installmentWaqfId = installmentWaqf.id;
    waqfIds.push(installmentWaqf.id);

    const lumpSumWaqf = await prisma.waqf.create({
      data: {
        name: "Contributions Spec Lump Sum Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId,
        fundingPlan: "lump_sum",
        corpusAmount: "5000",
        corpusCurrency: "USD",
      },
    });
    lumpSumWaqfId = lumpSumWaqf.id;
    waqfIds.push(lumpSumWaqf.id);
  });

  afterAll(async () => {
    // Same reasoning as every other spec in this codebase — fixture
    // Founders/Foundations are left in place; audit_logs is insert-only
    // so anything it references can't be cleaned up anyway.
    await prisma.contribution.deleteMany({ where: { id: { in: contributionIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("initiate() rejects an amount below the configured minimum for the currency", async () => {
    await expect(
      service.initiate({
        waqfId,
        amount: "50.00",
        currency: "USD",
        provider: "stripe",
        founderId,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("initiate() accepts an amount at the configured minimum", async () => {
    const result = await service.initiate({
      waqfId,
      amount: "100.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(result.contribution.id);
    expect(result.contribution.status).toBe("pending");
  });

  test("initiate() rejects an installment plan's first payment below the configured percent floor", async () => {
    // Corpus is 10000, seeded installmentMinimumPercent is 25 -> floor
    // is 2500. Comfortably above the plain ContributionMinimum (100), so
    // this exercises the installment-specific check, not the general one.
    await expect(
      service.initiate({
        waqfId: installmentWaqfId,
        amount: "1000.00",
        currency: "USD",
        provider: "stripe",
        founderId,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("initiate() below the installment floor reports that floor, not the flat minimum", async () => {
    // amount (50) clears neither floor, but the founder should be told
    // the actual (installment) floor they need to clear, not the flat
    // ContributionMinimum they'd also fail.
    await expect(
      service.initiate({
        waqfId: installmentWaqfId,
        amount: "50.00",
        currency: "USD",
        provider: "stripe",
        founderId,
      }),
    ).rejects.toThrow(/25% of the declared corpus/);
  });

  test("initiate() accepts an installment first payment below the flat minimum when the percent floor alone is lower", async () => {
    // Corpus 300, percent 25 -> floor 75, which is BELOW the flat USD
    // ContributionMinimum (100). The percentage floor is authoritative
    // for a waqf's first payment on its own — a founder who declared a
    // smaller corpus can make a genuinely proportional first payment,
    // not one inflated by an unrelated flat floor.
    const smallWaqf = await prisma.waqf.create({
      data: {
        name: "Contributions Spec Small Installment Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId,
        fundingPlan: "installment",
        corpusAmount: "300",
        corpusCurrency: "USD",
      },
    });
    waqfIds.push(smallWaqf.id);

    const result = await service.initiate({
      waqfId: smallWaqf.id,
      amount: "75.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(result.contribution.id);
    expect(result.contribution.status).toBe("pending");
  });

  test("initiate() accepts an installment plan's first payment at the configured percent floor", async () => {
    const result = await service.initiate({
      waqfId: installmentWaqfId,
      amount: "2500.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(result.contribution.id);
    expect(result.contribution.status).toBe("pending");
  });

  test("initiate() rejects a lump-sum waqf's first payment below the full declared corpus", async () => {
    // Corpus is 5000 — comfortably above the flat USD minimum (100), so
    // this exercises the lump-sum-specific floor, not the general one.
    await expect(
      service.initiate({
        waqfId: lumpSumWaqfId,
        amount: "1000.00",
        currency: "USD",
        provider: "stripe",
        founderId,
      }),
    ).rejects.toThrow(/full declared corpus/);
  });

  test("initiate() accepts a lump-sum waqf's first payment at exactly the full corpus", async () => {
    const result = await service.initiate({
      waqfId: lumpSumWaqfId,
      amount: "5000.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(result.contribution.id);
    expect(result.contribution.status).toBe("pending");
  });

  test("initiate() rejects a first payment in a different currency than the declared corpus", async () => {
    const waqf = await prisma.waqf.create({
      data: {
        name: "Contributions Spec Currency Mismatch Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId,
        fundingPlan: "lump_sum",
        corpusAmount: "5000",
        corpusCurrency: "USD",
      },
    });
    waqfIds.push(waqf.id);

    await expect(
      service.initiate({
        waqfId: waqf.id,
        amount: "5000.00",
        currency: "EUR",
        provider: "stripe",
        founderId,
      }),
    ).rejects.toThrow(/same currency/);
  });

  // Regression coverage for the 2026-08-31 codebase audit finding: the
  // currency check previously only ran when confirmedCount === 0, so a
  // second (top-up) payment in a different currency than the declared
  // corpus went completely unchecked and silently blended into
  // WaqfsService's amountRaised sum. The fix moved the check outside the
  // "first payment" gate so it applies to every contribution.
  test("initiate() rejects a top-up (non-first) payment in a different currency than the declared corpus", async () => {
    const waqf = await prisma.waqf.create({
      data: {
        name: "Contributions Spec Top-Up Currency Mismatch Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId,
        fundingPlan: "installment",
        corpusAmount: "10000",
        corpusCurrency: "USD",
      },
    });
    waqfIds.push(waqf.id);

    const first = await service.initiate({
      waqfId: waqf.id,
      amount: "2500.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(first.contribution.id);
    stripeFake.nextWebhookResult = { providerReference: first.contribution.id, status: "confirmed" };
    const confirmed = await service.handleWebhook("stripe", Buffer.from("{}"), {});
    expect(confirmed?.status).toBe("confirmed");
    if (confirmed?.assetId) assetIds.push(confirmed.assetId);

    await expect(
      service.initiate({
        waqfId: waqf.id,
        amount: "100.00",
        currency: "EUR",
        provider: "stripe",
        founderId,
      }),
    ).rejects.toThrow(/same currency/);
  });

  test("initiate() rejects when the founder's primary contact hasn't verified email + WhatsApp yet", async () => {
    const unverifiedUser = await prisma.user.create({
      data: { email: `unverified-${Date.now()}@example.test`, fullName: "Unverified Contact" },
    });
    const unverifiedFounder = await prisma.founder.create({
      data: { name: "Contributions Spec Unverified Founder", kind: "institution" },
    });
    await prisma.founderMembership.create({
      data: { founderId: unverifiedFounder.id, userId: unverifiedUser.id, permissionLevel: "primary_contact" },
    });

    await expect(
      service.initiate({
        waqfId,
        amount: "500.00",
        currency: "USD",
        provider: "stripe",
        founderId: unverifiedFounder.id,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  test("initiate() rejects a waqf that doesn't belong to the calling founder", async () => {
    await expect(
      service.initiate({
        waqfId,
        amount: "500.00",
        currency: "USD",
        provider: "stripe",
        founderId: otherFounderId,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  test("initiate() creates a pending Contribution and returns the adapter's client payload", async () => {
    stripeFake.nextCreatePaymentResult = null; // use the default echo-back behavior
    const result = await service.initiate({
      waqfId,
      amount: "500.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(result.contribution.id);

    expect(result.contribution.status).toBe("pending");
    expect(result.contribution.providerReference).toBe(result.contribution.id);
  });

  // Regression coverage for the 2026-08-31 codebase audit finding: this
  // creation previously wrote no audit_logs row at all, unlike every
  // other governed-entity create() in this codebase.
  test("initiate() writes an audit_logs row for the new pending Contribution", async () => {
    const result = await service.initiate({
      waqfId,
      amount: "500.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(result.contribution.id);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: result.contribution.id, action: "contribution.initiated" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorType).toBe("founder_user");
    expect(logs[0].actorFounderId).toBe(founderId);
  });

  test("handleWebhook() rejects an invalid signature and makes no state changes", async () => {
    stripeFake.nextWebhookResult = null; // simulates a failed signature check
    const initiated = await service.initiate({
      waqfId,
      amount: "200.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(initiated.contribution.id);

    await expect(service.handleWebhook("stripe", Buffer.from("{}"), {})).rejects.toThrow(UnauthorizedException);

    const stillPending = await prisma.contribution.findUnique({ where: { id: initiated.contribution.id } });
    expect(stillPending?.status).toBe("pending");
  });

  test("handleWebhook() confirmed → Asset registered, Waqf flips to active, audit-logged", async () => {
    const initiated = await service.initiate({
      waqfId,
      amount: "1000.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(initiated.contribution.id);

    stripeFake.nextWebhookResult = { providerReference: initiated.contribution.id, status: "confirmed" };
    const confirmed = await service.handleWebhook("stripe", Buffer.from("{}"), {});

    expect(confirmed?.status).toBe("confirmed");
    expect(confirmed?.assetId).not.toBeNull();
    if (confirmed?.assetId) assetIds.push(confirmed.assetId);

    const asset = await prisma.asset.findUnique({ where: { id: confirmed!.assetId! } });
    expect((asset as Asset).category).toBe("cash");
    expect(asset?.estimatedValue.toString()).toBe("1000");

    const waqf = await prisma.waqf.findUnique({ where: { id: waqfId } });
    expect((waqf as Waqf).status).toBe("active");

    const logs = await prisma.auditLog.findMany({ where: { entityId: confirmed!.id } });
    expect(logs.some((l) => l.action === "contribution.confirmed")).toBe(true);
  });

  test("initiate() + handleWebhook() a second time against an already-active waqf succeeds (top-up), and the resulting Asset is named accordingly", async () => {
    // waqfId is already active by this point (the previous test's
    // confirmed contribution flipped it) — nothing in initiate() blocks
    // calling it again for the same waqf.
    const topUp = await service.initiate({
      waqfId,
      amount: "250.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(topUp.contribution.id);

    stripeFake.nextWebhookResult = { providerReference: topUp.contribution.id, status: "confirmed" };
    const confirmed = await service.handleWebhook("stripe", Buffer.from("{}"), {});
    expect(confirmed?.status).toBe("confirmed");
    if (confirmed?.assetId) assetIds.push(confirmed.assetId);

    const asset = await prisma.asset.findUnique({ where: { id: confirmed!.assetId! } });
    expect(asset?.name).toBe("Corpus top-up");
  });

  test("handleWebhook() failed → Contribution failed, no Asset created, Waqf untouched", async () => {
    // Fresh waqf so this test's "no Asset created / stays draft"
    // assertion isn't confused by the previous test's confirmed
    // contribution already having activated the shared fixture waqf.
    const freshWaqf = await prisma.waqf.create({
      data: { name: "Contributions Spec Failed-Path Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(freshWaqf.id);

    const initiated = await service.initiate({
      waqfId: freshWaqf.id,
      amount: "300.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(initiated.contribution.id);

    stripeFake.nextWebhookResult = { providerReference: initiated.contribution.id, status: "failed" };
    const failed = await service.handleWebhook("stripe", Buffer.from("{}"), {});

    expect(failed?.status).toBe("failed");
    expect(failed?.assetId).toBeNull();

    const waqf = await prisma.waqf.findUnique({ where: { id: freshWaqf.id } });
    expect((waqf as Waqf).status).toBe("draft");

    // Regression coverage for the 2026-08-31 codebase audit finding: a
    // declined/reversed payment previously flipped status to "failed"
    // with zero audit trail of when or why.
    const logs = await prisma.auditLog.findMany({ where: { entityId: failed!.id, action: "contribution.failed" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].before).toMatchObject({ status: "pending" });
    expect(logs[0].after).toMatchObject({ status: "failed" });
  });

  test("handleWebhook() is idempotent — replaying a confirmed webhook doesn't double-create an Asset", async () => {
    const initiated = await service.initiate({
      waqfId,
      amount: "150.00",
      currency: "USD",
      provider: "stripe",
      founderId,
    });
    contributionIds.push(initiated.contribution.id);

    stripeFake.nextWebhookResult = { providerReference: initiated.contribution.id, status: "confirmed" };
    const first = await service.handleWebhook("stripe", Buffer.from("{}"), {});
    if (first?.assetId) assetIds.push(first.assetId);

    const second = await service.handleWebhook("stripe", Buffer.from("{}"), {});
    expect(second?.assetId).toBe(first?.assetId);

    // Not filtered by name — this fixture waqf already has an earlier
    // confirmed contribution from the "confirmed → Asset registered"
    // test above, so this one is correctly named "Corpus top-up" now
    // (see ContributionsService.handleWebhook()'s own comment), not
    // "Initial contribution". Idempotency is the only thing under test
    // here: this specific asset id appears exactly once regardless.
    const assetsForContribution = await prisma.asset.findMany({ where: { waqfId } });
    expect(assetsForContribution.filter((a) => a.id === first?.assetId)).toHaveLength(1);
  });

  test("platformSummary() sums confirmed contributions by currency, across every waqf, excluding pending/failed", async () => {
    // A distinctive per-run currency code, not a real one (USD/NGN/etc)
    // — this is a shared dev DB with plenty of pre-existing confirmed
    // contributions in real currencies from other tests/fixtures, so
    // asserting an exact platform-wide total only holds for a currency
    // nothing else could have touched.
    const currency = `T${Date.now().toString(36).slice(-3).toUpperCase()}`;

    const confirmedA = await prisma.contribution.create({
      data: { waqfId, amount: "100", currency, provider: "stripe", providerReference: `platform-summary-a-${Date.now()}`, status: "confirmed" },
    });
    const confirmedB = await prisma.contribution.create({
      data: { waqfId, amount: "50", currency, provider: "stripe", providerReference: `platform-summary-b-${Date.now()}`, status: "confirmed" },
    });
    const pending = await prisma.contribution.create({
      data: { waqfId, amount: "999", currency, provider: "stripe", providerReference: `platform-summary-c-${Date.now()}`, status: "pending" },
    });
    const failed = await prisma.contribution.create({
      data: { waqfId, amount: "999", currency, provider: "stripe", providerReference: `platform-summary-d-${Date.now()}`, status: "failed" },
    });
    contributionIds.push(confirmedA.id, confirmedB.id, pending.id, failed.id);

    const summary = await service.platformSummary();
    const row = summary.find((s) => s.currency === currency);
    expect(row?.totalAmount.toString()).toBe("150");
  });
});
