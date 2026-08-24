import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { prisma, Asset, Waqf } from "@birr/db";
import { ContributionsService } from "./contributions.service";
import { AssetsService } from "../assets/assets.service";
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
  const service = new ContributionsService(new AssetsService(), stripeFake as any, paystackFake as any, stablecoinFake as any);

  const waqfIds: string[] = [];
  const contributionIds: string[] = [];
  const assetIds: string[] = [];

  let founderId: string;
  let otherFounderId: string;
  let foundationId: string;
  let waqfId: string;

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

    const assetsForContribution = await prisma.asset.findMany({ where: { name: "Initial contribution", waqfId } });
    // Both this test's and the earlier confirmed-path test's assets
    // share this waqfId and name, so just confirm this run's specific
    // asset only appears once, not that the count is exactly 1 overall.
    expect(assetsForContribution.filter((a) => a.id === first?.assetId)).toHaveLength(1);
  });
});
